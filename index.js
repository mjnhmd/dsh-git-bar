/**
 * dsh-git-bar — Host half.
 *
 * Six JSON routes over the platform `git` executable:
 *
 *   GET  /dsh-git-bar/info?sessionId=<id>[&dir=<absolute path>]
 *   GET  /dsh-git-bar/branches?sessionId=<id>[&dir=<absolute path>]
 *   GET  /dsh-git-bar/changes?sessionId=<id>[&dir=<absolute path>]
 *   GET  /dsh-git-bar/diff?sessionId=<id>[&dir=<absolute path>]&path=<relative>[&staged=0|1]
 *   POST /dsh-git-bar/branches/checkout   {"sessionId","dir","branch"}
 *   POST /dsh-git-bar/branches/create     {"sessionId","dir","name","from"?}
 *
 * The routes report the repository a Session runs in, its branches, its changed
 * files, and a single file's unified diff; the two POSTs switch the working
 * tree to another branch. Only the POSTs write, and only by running plain
 * `git checkout` with an argument array: no shell, and a branch name that git
 * itself refuses (`git check-ref-format --branch`) never reaches the checkout.
 *
 * No route runs git for a directory the client invented: the directory is
 * resolved from the Session store first, and a caller-supplied `dir` is only a
 * fallback for a Session the store no longer knows, accepted after an
 * absolute-path check. The POSTs read `sessionId`/`dir` from the JSON body with
 * the same precedence.
 *
 * Requests are admitted through the harness's own browser session
 * (`ctx.connection.requestRejection`), the same gate the `/api` bridge uses, so
 * every route is unreachable without the GUI's credentials.
 *
 * Every git call is an argument array (no shell) with a timeout and a bounded
 * buffer, so a slow or huge repository degrades into an error instead of a
 * stall. Nothing is watched and nothing is cached.
 */

import { execFile } from 'node:child_process'
import { basename, isAbsolute } from 'node:path'

/** Plugin identity, as the Loader row names it. */
export const name = 'dsh-git-bar'

/** The services this row needs before it may mount. */
export const inject = ['webServer']

/** Route reporting the repository itself. */
const ROUTE_INFO = '/dsh-git-bar/info'

/** Route listing local branches. */
const ROUTE_BRANCHES = '/dsh-git-bar/branches'

/** Route switching to an existing branch. */
const ROUTE_CHECKOUT = '/dsh-git-bar/branches/checkout'

/** Route creating a branch and switching to it. */
const ROUTE_CREATE = '/dsh-git-bar/branches/create'

/** Route listing the changed files. */
const ROUTE_CHANGES = '/dsh-git-bar/changes'

/** Route returning one file's unified diff. */
const ROUTE_DIFF = '/dsh-git-bar/diff'

/** Per-call git timeout. A status read on a large repository stays well below it. */
const GIT_TIMEOUT_MS = 4000

/** Largest accepted stdout per git call; a pathological diff is truncated, not buffered whole. */
const GIT_MAX_BUFFER = 256 * 1024

/** Largest accepted JSON request body; the checkout/create payloads are tiny. */
const BODY_LIMIT_BYTES = 8 * 1024

/** Largest diff returned to the client; anything longer is cut and flagged. */
const DIFF_LIMIT_CHARS = 200_000

/** Largest number of changed files described; the totals still count them all. */
const MAX_CHANGED_FILES = 500

/** How many git child processes a per-file fan-out may keep in flight. */
const GIT_CONCURRENCY = 8

/** The all-zero change summary used outside a repository. */
const NO_DIRTY = { changed: 0, staged: 0, unstaged: 0, untracked: 0 }

/** `for-each-ref` columns: short name, upstream, HEAD marker, last subject. */
const BRANCH_FORMAT = '%(refname:short)%00%(upstream:short)%00%(HEAD)%00%(subject)'

/**
 * Run git in one directory and resolve with its output.
 *
 * Output is trimmed by default. Line-oriented raw output (porcelain status, a
 * diff) must pass `trim: false`: a leading space is data there — ` M file` is
 * an unstaged edit while `M  file` is a staged one, and trimming merges the two.
 *
 * @param cwd - absolute directory.
 * @param args - argument array, never a shell string.
 * @param options - `trim: false` keeps the stdout verbatim.
 * @returns the exit status, whether the buffer overflowed, and the
 *   stdout/stderr; never rejects.
 */
function runGit(cwd, args, options = {}) {
  const trim = options.trim !== false
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? '')
        resolve({
          ok: error === null || error === undefined,
          // The child was killed because its output outgrew the buffer; what
          // arrived is a prefix of real output, which a caller may report as
          // truncated rather than as a failure.
          overflow: error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          out: trim ? out.trim() : out,
          err: String(stderr ?? '').trim(),
        })
      },
    )
  })
}

/**
 * Summarize `git status --porcelain=v1` output.
 * @param text - porcelain output, one entry per line.
 * @returns totals per kind of change.
 */
function summarizeStatus(text) {
  let changed = 0
  let staged = 0
  let unstaged = 0
  let untracked = 0
  for (const line of text.split('\n')) {
    if (line.length < 3) continue
    changed += 1
    const index = line[0]
    const worktree = line[1]
    if (index === '?' && worktree === '?') {
      untracked += 1
      continue
    }
    if (index !== ' ' && index !== '?') staged += 1
    if (worktree !== ' ' && worktree !== '?') unstaged += 1
  }
  return { changed, staged, unstaged, untracked }
}

/**
 * Read the git facts for one directory.
 * @param dir - absolute directory, whether or not it is a repository.
 * @returns the `repository` object sent to the Client half, or null.
 */
async function repositoryFor(dir) {
  const inside = await runGit(dir, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.out !== 'true') return null

  const [rootResult, symbolicResult, shaResult, statusResult, upstreamResult, worktreeResult] = await Promise.all([
    runGit(dir, ['rev-parse', '--show-toplevel']),
    runGit(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    runGit(dir, ['rev-parse', '--short', 'HEAD']),
    runGit(dir, ['status', '--porcelain=v1', '-uall'], { trim: false }),
    runGit(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    runGit(dir, ['worktree', 'list', '--porcelain']),
  ])

  const root = rootResult.ok && rootResult.out !== '' ? rootResult.out : dir
  const branch = symbolicResult.ok && symbolicResult.out !== '' ? symbolicResult.out : null
  const dirty = summarizeStatus(statusResult.ok ? statusResult.out : '')
  const upstream = upstreamResult.ok && upstreamResult.out !== '' ? upstreamResult.out : null

  let ahead = null
  let behind = null
  if (upstream !== null) {
    const counts = await runGit(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
    if (counts.ok) {
      const [left, right] = counts.out.split(/\s+/)
      const parsedAhead = Number(left)
      const parsedBehind = Number(right)
      ahead = Number.isFinite(parsedAhead) ? parsedAhead : null
      behind = Number.isFinite(parsedBehind) ? parsedBehind : null
    }
  }

  const worktrees = worktreeResult.ok ? worktreeResult.out : ''
  const mainRoot = /^worktree (.+)$/m.exec(worktrees)?.[1]?.trim() ?? null

  return {
    root,
    name: basename(root),
    branch,
    detached: branch === null,
    sha: shaResult.ok && shaResult.out !== '' ? shaResult.out : null,
    dirty,
    upstream,
    ahead,
    behind,
    worktree: {
      linked: mainRoot !== null && mainRoot !== root,
      mainRoot,
    },
  }
}

/**
 * Read the git facts for one directory, wrapped in the `/info` reply body.
 * @param dir - absolute directory, whether or not it is a repository.
 * @returns the reply body sent to the Client half.
 */
async function inspect(dir) {
  const repository = await repositoryFor(dir)
  if (repository === null) return { dir, repository: null, reason: 'not-a-repository' }
  return { dir, repository }
}

/**
 * Server-side directory for one request: the Session store is authoritative.
 * @param ctx - plugin context.
 * @param sessionId - Session id from the query string or the JSON body.
 * @param hint - caller-supplied absolute directory, used only as a fallback.
 * @returns an absolute directory, or undefined when none can be established.
 */
function resolveDirectory(ctx, sessionId, hint) {
  if (typeof sessionId === 'string' && sessionId !== '') {
    const sessions = ctx.get('sessions')
    try {
      const session = sessions?.get?.(sessionId)
      const cwd = session?.header?.cwd ?? session?.cwd
      if (typeof cwd === 'string' && isAbsolute(cwd)) return cwd
    } catch {
      // A Session that cannot be read falls through to the client-supplied hint.
    }
  }
  if (typeof hint === 'string' && isAbsolute(hint)) return hint
  return undefined
}

/**
 * Directory for a GET request, from its query string.
 * @param ctx - plugin context.
 * @param url - parsed request URL.
 * @returns an absolute directory, or undefined when none can be established.
 */
function directoryFor(ctx, url) {
  return resolveDirectory(ctx, url.searchParams.get('sessionId'), url.searchParams.get('dir'))
}

/**
 * Directory for a POST request, from its JSON body with the same precedence.
 * @param ctx - plugin context.
 * @param body - parsed JSON body.
 * @returns an absolute directory, or undefined when none can be established.
 */
function directoryFromBody(ctx, body) {
  return resolveDirectory(ctx, body.sessionId, body.dir)
}

/**
 * Answer one request with JSON.
 * @param res - server response.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/**
 * Parse the request URL against a fixed placeholder origin.
 * @param req - server request.
 * @returns the parsed URL.
 */
function requestUrl(req) {
  return new URL(String(req.url ?? '/'), 'http://dsh.internal')
}

/**
 * Read a bounded JSON object body.
 *
 * A body that is already parsed (some hosts attach one), is not JSON, is
 * larger than `BODY_LIMIT_BYTES`, or is not a JSON object is refused.
 *
 * @param req - server request.
 * @returns the parsed object, or undefined when the body is unusable.
 */
async function readJsonBody(req) {
  const attached = req.body
  if (attached !== null && typeof attached === 'object' && !Array.isArray(attached) && !Buffer.isBuffer(attached)) {
    return attached
  }
  const declared = String(req.headers?.['content-type'] ?? '').toLowerCase()
  if (declared !== '' && !declared.includes('json')) return undefined
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += buffer.length
      if (size > BODY_LIMIT_BYTES) return undefined
      chunks.push(buffer)
    }
  } catch {
    return undefined
  }
  if (size === 0) return undefined
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  return parsed
}

/**
 * Apply the shared gate every route uses: connection, browser session, method.
 *
 * @param ctx - plugin context.
 * @param req - server request.
 * @param res - server response.
 * @param method - the only HTTP method this route accepts.
 * @returns true when the handler should continue; false when it already answered.
 */
function admit(ctx, req, res, method) {
  const connection = ctx.get('connection')
  if (connection === undefined) {
    sendJson(res, 503, { error: 'no-connection' })
    return false
  }
  const rejection = connection.requestRejection(req)
  if (rejection !== undefined) {
    res.statusCode = rejection
    res.end()
    return false
  }
  if (req.method !== method) {
    res.statusCode = 405
    res.setHeader('allow', method)
    res.end()
    return false
  }
  return true
}

/**
 * Describe a failed git call without leaking a stack.
 * @param result - the `runGit` result.
 * @returns the first 400 characters of git's own complaint.
 */
function failureMessage(result) {
  const text = result.err !== '' ? result.err : result.out
  const message = text === '' ? 'git refused the request' : text
  return message.slice(0, 400)
}

/**
 * Run an async callback over items with bounded concurrency.
 * @param items - items to visit.
 * @param limit - largest number of callbacks in flight.
 * @param visit - async callback, awaited per item.
 * @returns a promise resolved once every item has been visited.
 */
async function mapLimit(items, limit, visit) {
  const queue = items.slice()
  const workers = []
  const width = Math.min(limit, queue.length)
  for (let index = 0; index < width; index += 1) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const item = queue.shift()
          if (item !== undefined) await visit(item)
        }
      })(),
    )
  }
  await Promise.all(workers)
}

/**
 * Ask git itself whether a string may name a branch.
 * @param dir - absolute directory inside (or outside) a repository.
 * @param value - candidate branch name.
 * @returns true when git accepts it.
 */
async function validBranchName(dir, value) {
  if (typeof value !== 'string' || value === '' || value.includes('\0')) return false
  const checked = await runGit(dir, ['check-ref-format', '--branch', value])
  return checked.ok
}

/**
 * List local branches with their upstream tracking state.
 *
 * The current branch comes first, the rest in ascending name order. Each
 * branch with an upstream costs exactly one `rev-list` call for its
 * ahead/behind counts; a failing count leaves 0/0 rather than an error.
 *
 * @param dir - absolute directory.
 * @returns the branch list, empty outside a repository.
 */
async function readBranches(dir) {
  const refs = await runGit(dir, ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads'], { trim: false })
  if (!refs.ok) return []
  const branches = []
  for (const line of refs.out.split('\n')) {
    if (line === '') continue
    const [refname, upstream, head, subject] = line.split('\0')
    if (refname === undefined || refname === '') continue
    branches.push({
      name: refname,
      current: head === '*',
      upstream: upstream === undefined || upstream === '' ? null : upstream,
      ahead: 0,
      behind: 0,
      subject: subject ?? '',
    })
  }
  branches.sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1
    return left.name.localeCompare(right.name)
  })
  await mapLimit(branches, GIT_CONCURRENCY, async (branch) => {
    if (branch.upstream === null) return
    const counts = await runGit(dir, ['rev-list', '--left-right', '--count', `${branch.upstream}...${branch.name}`])
    if (!counts.ok) return
    // `<upstream>...<branch>` counts the left side first, so the branch is ahead by the right number.
    const [missing, extra] = counts.out.split(/\s+/)
    const parsedBehind = Number(missing)
    const parsedAhead = Number(extra)
    if (Number.isFinite(parsedAhead)) branch.ahead = parsedAhead
    if (Number.isFinite(parsedBehind)) branch.behind = parsedBehind
  })
  return branches
}

/**
 * Parse `git status --porcelain=v1 -z` output into file entries.
 *
 * In the NUL form a rename or copy record carries the new path in the record
 * itself and the original path in the following NUL field, so that field is
 * consumed here and only the new path is reported.
 *
 * @param text - raw porcelain output, `-z` form.
 * @returns one entry per reported path, plus the change totals.
 */
function parseStatusZ(text) {
  const fields = text.split('\0')
  const files = []
  let changed = 0
  let stagedCount = 0
  let unstagedCount = 0
  let untrackedCount = 0
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index]
    if (record === undefined || record.length < 3) continue
    const indexColumn = record[0]
    const worktreeColumn = record[1]
    let path = record.slice(3)
    if (indexColumn === 'R' || indexColumn === 'C' || worktreeColumn === 'R' || worktreeColumn === 'C') {
      if (fields[index + 1] !== undefined && fields[index + 1] !== '') index += 1
    }
    if (path === '') continue
    changed += 1
    const untracked = indexColumn === '?' && worktreeColumn === '?'
    const staged = indexColumn !== ' ' && indexColumn !== '?'
    if (untracked) untrackedCount += 1
    if (staged) stagedCount += 1
    if (worktreeColumn !== ' ' && worktreeColumn !== '?') unstagedCount += 1
    const status = untracked ? '?' : indexColumn !== ' ' ? indexColumn : worktreeColumn
    files.push({ path, status, staged, additions: null, deletions: null })
  }
  return {
    files,
    dirty: { changed, staged: stagedCount, unstaged: unstagedCount, untracked: untrackedCount },
  }
}

/**
 * Read git's line counts for one path on one side of the index.
 *
 * A binary file reports `-\t-`, an untracked file no line at all; both become
 * null/null so the client can tell "not measured" from "no lines added".
 *
 * @param dir - absolute directory.
 * @param path - repo-relative path.
 * @param staged - true for the index side, false for the worktree side.
 * @returns the addition and deletion counts, null when git does not know them.
 */
async function lineStats(dir, path, staged) {
  const args = staged ? ['diff', '--cached', '--numstat', '--', path] : ['diff', '--numstat', '--', path]
  const result = await runGit(dir, args)
  if (!result.ok || result.out === '') return { additions: null, deletions: null }
  const [rawAdditions, rawDeletions] = (result.out.split('\n')[0] ?? '').split('\t')
  const additions = Number(rawAdditions)
  const deletions = Number(rawDeletions)
  return {
    additions: Number.isFinite(additions) ? additions : null,
    deletions: Number.isFinite(deletions) ? deletions : null,
  }
}

/**
 * Read the changed files for one directory.
 * @param dir - absolute directory.
 * @returns the change totals and up to `MAX_CHANGED_FILES` described files.
 */
async function readChanges(dir) {
  const status = await runGit(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { trim: false })
  if (!status.ok) throw new Error(failureMessage(status))
  const parsed = parseStatusZ(status.out)
  const files = parsed.files.slice(0, MAX_CHANGED_FILES)
  await mapLimit(files, GIT_CONCURRENCY, async (file) => {
    const stats = await lineStats(dir, file.path, file.staged)
    file.additions = stats.additions
    file.deletions = stats.deletions
  })
  return { dirty: parsed.dirty, files, truncated: parsed.files.length > MAX_CHANGED_FILES }
}

/**
 * Decide whether a caller-supplied path may be handed to git.
 *
 * Only a non-empty repository-relative path is accepted: no absolute path, no
 * `..` segment, no NUL byte. This keeps `-- <path>` a pathspec and never an
 * option or an escape from the repository.
 *
 * @param value - candidate path.
 * @returns true when the path is safe to use as a pathspec.
 */
function validRepoPath(value) {
  if (typeof value !== 'string' || value === '') return false
  if (value.includes('\0')) return false
  if (value.startsWith('/')) return false
  if (isAbsolute(value)) return false
  if (value.split(/[\\/]/).includes('..')) return false
  return true
}

/**
 * Read one file's unified diff.
 * @param dir - absolute directory.
 * @param path - repo-relative path.
 * @param staged - true for the index side, false for the worktree side.
 * @returns the diff text and whether it had to be cut.
 */
async function readDiff(dir, path, staged) {
  const args = staged
    ? ['diff', '--no-color', '--cached', '--', path]
    : ['diff', '--no-color', '--', path]
  let result = await runGit(dir, args, { trim: false })
  if (result.ok && !result.overflow && result.out.trim() === '' && !staged) {
    // An untracked file has nothing to diff against: show it against /dev/null,
    // which is what `git add -N` + `git diff` would print. A tracked file with an
    // empty worktree diff stays empty, so ask git which one this is first.
    const tracked = await runGit(dir, ['ls-files', '--error-unmatch', '--', path])
    if (!tracked.ok) {
      const against = await runGit(dir, ['diff', '--no-color', '--no-index', '--', '/dev/null', path], {
        trim: false,
      })
      // `--no-index` exits 1 whenever the files differ, which is the normal case.
      if (against.out.trim() !== '') result = { ...against, ok: true }
    }
  }
  // An overflow is a cut diff, not a failed one: the prefix in `out` is real.
  if (!result.ok && !result.overflow) throw new Error(failureMessage(result))
  const truncated = result.overflow || result.out.length > DIFF_LIMIT_CHARS
  return { diff: truncated ? result.out.slice(0, DIFF_LIMIT_CHARS) : result.out, truncated }
}

/**
 * Handle a GET route: auth gate, method guard, directory, then the reader.
 * @param ctx - plugin context.
 * @param req - server request.
 * @param res - server response.
 * @param slug - error slug used when the reader throws.
 * @param run - reader returning `{ status, body }` for the resolved directory.
 */
async function serveGet(ctx, req, res, slug, run) {
  if (!admit(ctx, req, res, 'GET')) return
  const url = requestUrl(req)
  const dir = directoryFor(ctx, url)
  if (dir === undefined) {
    sendJson(res, 400, { error: 'no-directory' })
    return
  }
  try {
    const reply = await run(dir, url)
    sendJson(res, reply.status, reply.body)
  } catch (error) {
    sendJson(res, 500, {
      error: slug,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Handle a POST route: auth gate, method guard, bounded body, directory, then the writer.
 * @param ctx - plugin context.
 * @param req - server request.
 * @param res - server response.
 * @param slug - error slug used when the writer throws.
 * @param run - writer returning `{ status, body }` for the resolved directory.
 */
async function servePost(ctx, req, res, slug, run) {
  if (!admit(ctx, req, res, 'POST')) return
  const body = await readJsonBody(req)
  if (body === undefined) {
    sendJson(res, 400, { error: 'invalid-body' })
    return
  }
  const dir = directoryFromBody(ctx, body)
  if (dir === undefined) {
    sendJson(res, 400, { error: 'no-directory' })
    return
  }
  try {
    const reply = await run(dir, body)
    sendJson(res, reply.status, reply.body)
  } catch (error) {
    sendJson(res, 500, {
      error: slug,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Mount the six routes.
 * @param ctx - plugin context; `webServer` arrives through `inject`.
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_INFO,
        handler: (req, res) =>
          serveGet(ctx, req, res, 'inspection-failed', async (dir) => ({ status: 200, body: await inspect(dir) })),
      }),
    `git-bar: GET ${ROUTE_INFO}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_BRANCHES,
        handler: (req, res) =>
          serveGet(ctx, req, res, 'branches-failed', async (dir) => {
            const [repository, branches] = await Promise.all([repositoryFor(dir), readBranches(dir)])
            return {
              status: 200,
              body: {
                dir,
                repository,
                ...(repository === null ? { reason: 'not-a-repository' } : {}),
                branches: repository === null ? [] : branches,
                dirty: repository === null ? NO_DIRTY : repository.dirty,
              },
            }
          }),
      }),
    `git-bar: GET ${ROUTE_BRANCHES}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_CHANGES,
        handler: (req, res) =>
          serveGet(ctx, req, res, 'changes-failed', async (dir) => ({
            status: 200,
            body: { dir, ...(await readChanges(dir)) },
          })),
      }),
    `git-bar: GET ${ROUTE_CHANGES}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_DIFF,
        handler: (req, res) =>
          serveGet(ctx, req, res, 'diff-failed', async (dir, url) => {
            const path = url.searchParams.get('path') ?? ''
            if (!validRepoPath(path)) return { status: 400, body: { error: 'invalid-path' } }
            const staged = ['1', 'true'].includes(url.searchParams.get('staged') ?? '')
            const { diff, truncated } = await readDiff(dir, path, staged)
            return { status: 200, body: { path, staged, diff, truncated } }
          }),
      }),
    `git-bar: GET ${ROUTE_DIFF}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_CHECKOUT,
        handler: (req, res) =>
          servePost(ctx, req, res, 'checkout-failed', async (dir, body) => {
            const branch = body.branch
            if (!(await validBranchName(dir, branch))) return { status: 400, body: { error: 'invalid-branch' } }
            const result = await runGit(dir, ['checkout', branch])
            if (!result.ok) {
              return { status: 409, body: { error: 'checkout-refused', message: failureMessage(result) } }
            }
            return { status: 200, body: { branch, created: false } }
          }),
      }),
    `git-bar: POST ${ROUTE_CHECKOUT}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_CREATE,
        handler: (req, res) =>
          servePost(ctx, req, res, 'create-failed', async (dir, body) => {
            const name = body.name
            if (!(await validBranchName(dir, name))) return { status: 400, body: { error: 'invalid-branch' } }
            const from = body.from
            const args = ['checkout', '-b', name]
            if (typeof from === 'string' && from !== '') {
              if (!(await validBranchName(dir, from))) return { status: 400, body: { error: 'invalid-branch' } }
              args.push(from)
            }
            const result = await runGit(dir, args)
            if (!result.ok) {
              return { status: 409, body: { error: 'create-refused', message: failureMessage(result) } }
            }
            return { status: 200, body: { branch: name, created: true } }
          }),
      }),
    `git-bar: POST ${ROUTE_CREATE}`,
  )
}
