/**
 * dsh-git-bar — Host half.
 *
 * Eleven JSON routes over the platform `git` executable:
 *
 *   GET  /dsh-git-bar/info?sessionId=<id>[&dir=<absolute path>]
 *   GET  /dsh-git-bar/branches?sessionId=<id>[&dir=<absolute path>]
 *   GET  /dsh-git-bar/worktrees?sessionId=<id>[&dir=<absolute path>]
 *   GET  /dsh-git-bar/changes?sessionId=<id>[&dir=<absolute path>]
 *   GET  /dsh-git-bar/diff?sessionId=<id>[&dir=<absolute path>]&path=<relative>[&staged=0|1]
 *   GET  /dsh-git-bar/log?sessionId=<id>[&dir=<absolute path>][&limit=<1..300>][&branch=<ref>][&author=<text>]
 *   GET  /dsh-git-bar/commit?sessionId=<id>[&dir=<absolute path>]&hash=<4..40 hex>
 *   GET  /dsh-git-bar/commit-diff?sessionId=<id>[&dir=<absolute path>]&hash=<4..40 hex>&path=<relative>
 *   GET  /dsh-git-bar/authors?sessionId=<id>[&dir=<absolute path>]
 *   POST /dsh-git-bar/branches/checkout   {"sessionId","dir","branch"}
 *   POST /dsh-git-bar/branches/create     {"sessionId","dir","name","from"?}
 *
 * The routes report the repository a Session runs in, its branches, its changed
 * files, and a single file's unified diff; the three history routes add the
 * commit graph (`log`), one commit's file list (`commit`) and one file's diff
 * inside that commit (`commit-diff`), and `authors` lists every commit author in
 * the whole history so the graph can be filtered by one, all read-only. The two
 * POSTs switch the working tree to another branch. Only the POSTs write, and
 * only by running plain `git checkout` with an argument array: no shell, and a
 * branch name that git itself refuses (`git check-ref-format --branch`) never
 * reaches the checkout.
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
import { realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'

/** Plugin identity, as the Loader row names it. */
export const name = 'dsh-git-bar'

/** The services this row needs before it may mount. */
export const inject = ['webServer']

/** Route reporting the repository itself. */
const ROUTE_INFO = '/dsh-git-bar/info'

/** Route listing local branches. */
const ROUTE_BRANCHES = '/dsh-git-bar/branches'

/** Route listing this repository's worktrees. */
const ROUTE_WORKTREES = '/dsh-git-bar/worktrees'

/** Route switching to an existing branch. */
const ROUTE_CHECKOUT = '/dsh-git-bar/branches/checkout'

/** Route creating a branch and switching to it. */
const ROUTE_CREATE = '/dsh-git-bar/branches/create'

/** Route listing the changed files. */
const ROUTE_CHANGES = '/dsh-git-bar/changes'

/** Route returning one file's unified diff. */
const ROUTE_DIFF = '/dsh-git-bar/diff'

/** Route listing the commit graph. */
const ROUTE_LOG = '/dsh-git-bar/log'

/** Route describing one commit and the files it touched. */
const ROUTE_COMMIT = '/dsh-git-bar/commit'

/** Route returning one file's diff inside one commit. */
const ROUTE_COMMIT_DIFF = '/dsh-git-bar/commit-diff'

/** Route listing every commit author in the history. */
const ROUTE_AUTHORS = '/dsh-git-bar/authors'

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

/** Largest number of worktrees described; a worktree costs one status call. */
const MAX_WORKTREES = 16

/** How many git child processes a per-file fan-out may keep in flight. */
const GIT_CONCURRENCY = 8

/** The all-zero change summary used outside a repository. */
const NO_DIRTY = { changed: 0, staged: 0, unstaged: 0, untracked: 0 }

/** `for-each-ref` columns: short name, upstream, HEAD marker, last subject. */
const BRANCH_FORMAT = '%(refname:short)%00%(upstream:short)%00%(HEAD)%00%(subject)'

/**
 * `git log` record: hash, short hash, parents, author, email, ISO date,
 * subject, decorations. Fields are separated by US, records by RS — two bytes
 * git never prints inside a one-line subject.
 */
const LOG_FORMAT = '%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e'

/** `git show` record: the log columns, with the message body in place of the decorations. */
const COMMIT_FORMAT = '%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e'

/** `/authors` record: one author name and email per commit. */
const AUTHOR_FORMAT = '%an%x1f%ae'

/** The unit separator `LOG_FORMAT` and `COMMIT_FORMAT` put between columns. */
const FIELD_SEPARATOR = '\u001f'

/** The record separator `LOG_FORMAT` and `COMMIT_FORMAT` put after a record. */
const RECORD_SEPARATOR = '\u001e'

/** Commits per `/log` page when the caller asks for no particular size. */
const DEFAULT_LOG_LIMIT = 60

/** Largest `/log` page a caller may ask for. */
const MAX_LOG_LIMIT = 300

/** Largest number of files described for one commit; the count still reports them all. */
const MAX_COMMIT_FILES = 500

/** Largest number of author candidates described; a longer list is cut and flagged. */
const MAX_AUTHORS = 500

/** The only shape a revision may have: 4..40 hex digits, never an option or a path. */
const HASH_PATTERN = /^[0-9a-f]{4,40}$/i

/** C0 controls and DEL, which no path may contain. */
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/

/** Longest accepted `/log` filter value; a longer one is a bug, not a query. */
const MAX_FILTER_CHARS = 200

/** The only shape a `branch` filter may have: a refname, never an option or a range. */
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/

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
 * Parse `git worktree list --porcelain` output into one record per worktree.
 *
 * Records are separated by a `worktree <path>` line; the members below it are
 * `HEAD <sha>`, `branch <ref>`, or one of the bare flags. A `locked` or
 * `prunable` line may carry a reason after the keyword.
 *
 * @param text - raw porcelain output.
 * @returns one record per worktree, in git's order (the main worktree first).
 */
function parseWorktrees(text) {
  const entries = []
  let current = null
  for (const line of text.split('\n')) {
    if (line === '') continue
    const space = line.indexOf(' ')
    const key = space === -1 ? line : line.slice(0, space)
    const value = space === -1 ? '' : line.slice(space + 1).trim()
    if (key === 'worktree') {
      current = { path: value, sha: null, branch: null, detached: false, bare: false, locked: false, prunable: false }
      entries.push(current)
      continue
    }
    if (current === null) continue
    if (key === 'HEAD') current.sha = value
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'detached') current.detached = true
    else if (key === 'bare') current.bare = true
    else if (key === 'locked') current.locked = true
    else if (key === 'prunable') current.prunable = true
  }
  return entries
}

/**
 * Compare two directories the way git does: by their real path when it exists.
 * @param value - absolute directory.
 * @returns the canonical form used for comparisons.
 */
function canonicalPath(value) {
  try {
    return realpathSync(value)
  } catch {
    return resolve(value)
  }
}

/**
 * Turn a git remote URL into the browsing URL of that repository.
 *
 * The scp form (`git@host:owner/repo.git`), `ssh://`, `git://` and plain http(s)
 * all collapse to `https://host/owner/repo`; a local path or `file://` remote
 * has no browsing URL and yields null. Hosts whose commit route differs are
 * handled by `commitUrlFor`.
 *
 * @param remoteUrl - `git remote get-url` output.
 * @returns the https browsing URL, or null when the remote is not hostable.
 */
function webUrlFor(remoteUrl) {
  if (typeof remoteUrl !== 'string') return null
  const value = remoteUrl.trim()
  if (value === '') return null
  let host = null
  let path = null
  if (/^(?:https?|git|ssh):\/\//i.test(value)) {
    try {
      const parsed = new URL(value)
      if (parsed.hostname === '') return null
      host = parsed.port === '' ? parsed.hostname : `${parsed.hostname}:${parsed.port}`
      path = parsed.pathname
    } catch {
      return null
    }
  } else {
    // scp 形式：`[user@]host:path`，冒号后不是绝对路径。
    const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+)$/.exec(value)
    if (scp === null) return null
    host = scp[1]
    path = scp[2]
  }
  const clean = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
  if (clean === '' || host === null) return null
  return `https://${host}/${clean}`
}

/**
 * The commit page of one revision on a given web host.
 *
 * GitHub and Gitea serve `/commit/<sha>`; GitLab inserts `/-/`; Bitbucket uses
 * the plural `/commits/<sha>`.
 *
 * @param webUrl - repository browsing URL, or null.
 * @param sha - full commit id, or null.
 * @returns the commit page URL, or null when either half is missing.
 */
function commitUrlFor(webUrl, sha) {
  if (webUrl === null || typeof sha !== 'string' || sha === '') return null
  if (/bitbucket\./i.test(webUrl)) return `${webUrl}/commits/${sha}`
  if (/gitlab/i.test(webUrl)) return `${webUrl}/-/commit/${sha}`
  return `${webUrl}/commit/${sha}`
}

/**
 * Read the git facts for one directory.
 * @param dir - absolute directory, whether or not it is a repository.
 * @returns the `repository` object sent to the Client half, or null.
 */
async function repositoryFor(dir) {
  const inside = await runGit(dir, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.out !== 'true') return null

  const [rootResult, symbolicResult, shaResult, fullShaResult, statusResult, upstreamResult, worktreeResult, remoteResult] = await Promise.all([
    runGit(dir, ['rev-parse', '--show-toplevel']),
    runGit(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    runGit(dir, ['rev-parse', '--short', 'HEAD']),
    runGit(dir, ['rev-parse', 'HEAD']),
    runGit(dir, ['status', '--porcelain=v1', '-uall'], { trim: false }),
    runGit(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    runGit(dir, ['worktree', 'list', '--porcelain']),
    runGit(dir, ['remote', 'get-url', 'origin']),
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

  const worktrees = worktreeResult.ok ? parseWorktrees(worktreeResult.out) : []
  const mainRoot = worktrees[0]?.path ?? null

  return {
    root,
    name: basename(root),
    branch,
    detached: branch === null,
    sha: shaResult.ok && shaResult.out !== '' ? shaResult.out : null,
    // 状态条最右边那个短 sha 点开就是远端仓库的这一次提交。
    commitUrl: commitUrlFor(
      webUrlFor(remoteResult.ok ? remoteResult.out : ''),
      fullShaResult.ok && fullShaResult.out !== '' ? fullShaResult.out : null,
    ),
    remote: remoteResult.ok && remoteResult.out !== ''
      ? { url: remoteResult.out, webUrl: webUrlFor(remoteResult.out) }
      : null,
    dirty,
    upstream,
    ahead,
    behind,
    worktree: {
      linked: mainRoot !== null && mainRoot !== root,
      mainRoot,
      count: worktrees.length,
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
  const [refs, listed] = await Promise.all([
    runGit(dir, ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads'], { trim: false }),
    runGit(dir, ['worktree', 'list', '--porcelain']),
  ])
  if (!refs.ok) return []
  // 一个分支同一时刻只能被一个工作树 checkout。记下它挂在哪个目录，客户端就能把
  // 「点下去必然被 git 拒绝」的分支提前标灰，而不是让用户吃一句笼统的“切换失败”。
  const checkedOut = new Map()
  for (const entry of listed.ok ? parseWorktrees(listed.out) : []) {
    if (entry.branch !== null) checkedOut.set(entry.branch, entry.path)
  }
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
      checkedOutIn: checkedOut.get(refname) ?? null,
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
 * Describe every worktree of the repository this directory belongs to.
 *
 * Each worktree costs one `status` call for its own change count; a worktree
 * whose directory is missing or prunable is listed without one. The current
 * worktree is the one whose real path matches this directory's repository root.
 *
 * @param dir - absolute directory inside the repository.
 * @returns the worktree list, or null outside a repository.
 */
async function readWorktrees(dir) {
  const listed = await runGit(dir, ['worktree', 'list', '--porcelain'])
  if (!listed.ok) return null
  const rootResult = await runGit(dir, ['rev-parse', '--show-toplevel'])
  const root = rootResult.ok && rootResult.out !== '' ? rootResult.out : dir
  const current = canonicalPath(root)
  const worktrees = parseWorktrees(listed.out).slice(0, MAX_WORKTREES).map((entry) => ({
    path: entry.path,
    name: basename(entry.path),
    branch: entry.branch,
    detached: entry.detached,
    sha: entry.sha,
    bare: entry.bare,
    locked: entry.locked,
    prunable: entry.prunable,
    main: entry.path === parseWorktrees(listed.out)[0]?.path,
    current: canonicalPath(entry.path) === current,
    dirty: null,
  }))
  await mapLimit(
    worktrees.filter((entry) => !entry.bare && !entry.prunable),
    GIT_CONCURRENCY,
    async (entry) => {
      const status = await runGit(entry.path, ['status', '--porcelain=v1', '-uall'], { trim: false })
      if (status.ok) entry.dirty = summarizeStatus(status.out)
    },
  )
  return { root, worktrees }
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
 * Decide whether a caller-supplied path may be used as a pathspec inside a commit.
 *
 * Stricter than `validRepoPath` on purpose: a leading `-` and any control
 * character are refused here as well, so the value stays a path even if a
 * future caller forgets the `--` separator that keeps git from reading it as an
 * option.
 *
 * @param value - candidate path.
 * @returns true when the path is a plain repository-relative path.
 */
function validCommitPath(value) {
  if (!validRepoPath(value)) return false
  if (value.startsWith('-')) return false
  return !CONTROL_PATTERN.test(value)
}

/**
 * Decide whether a caller-supplied revision may be handed to git.
 * @param value - candidate revision.
 * @returns true for 4..40 hex digits, the only form that cannot name an option or a path.
 */
function validHash(value) {
  return typeof value === 'string' && HASH_PATTERN.test(value)
}

/**
 * Read one optional `/log` filter from the query string.
 *
 * An absent parameter and an empty one both mean "no filter": a Client that
 * always appends `branch=&author=` should still see the whole graph.
 *
 * @param url - parsed request URL.
 * @param key - parameter name, `branch` or `author`.
 * @returns the trimmed value, or null when the filter is not in use.
 */
function filterValue(url, key) {
  const raw = url.searchParams.get(key)
  if (raw === null) return null
  const value = raw.trim()
  return value === '' ? null : value
}

/**
 * Decide whether a caller-supplied `branch` filter may be handed to git as a revision.
 *
 * The character set is closed — no space, quote, glob or `~`/`^`/`:` revision
 * operator — a leading `-` is refused so the value can never be read as an
 * option, and `..` is refused so it can never become a range.
 *
 * @param value - candidate branch or ref name.
 * @returns true when the value is a plain refname.
 */
function validBranchFilter(value) {
  if (typeof value !== 'string' || value === '') return false
  if (value.length > MAX_FILTER_CHARS) return false
  if (!BRANCH_PATTERN.test(value)) return false
  if (value.startsWith('-')) return false
  return !value.includes('..')
}

/**
 * Decide whether a caller-supplied `author` filter may be handed to git.
 *
 * git reads `--author` as a regular expression, so the text is left alone
 * beyond the two rules that keep it a value: it is bounded, and it carries no
 * control characters. A pattern git itself then rejects is reported as a 400
 * once the command has run.
 *
 * @param value - candidate author text.
 * @returns true when the value may be passed as `--author=<text>`.
 */
function validAuthorFilter(value) {
  if (typeof value !== 'string' || value === '') return false
  if (value.length > MAX_FILTER_CHARS) return false
  return !CONTROL_PATTERN.test(value)
}

/**
 * Read the page size a `/log` request asks for.
 *
 * An absent, empty or non-numeric `limit` means the default; a numeric one is
 * clamped to 1..`MAX_LOG_LIMIT` rather than refused, so a stale client cannot
 * break the view.
 *
 * @param url - parsed request URL.
 * @returns the page size to use.
 */
function parseLimit(url) {
  const raw = url.searchParams.get('limit')
  if (raw === null || raw.trim() === '') return DEFAULT_LOG_LIMIT
  const value = Number(raw)
  if (!Number.isFinite(value)) return DEFAULT_LOG_LIMIT
  return Math.min(MAX_LOG_LIMIT, Math.max(1, Math.trunc(value)))
}

/**
 * Cut an oversized diff at the shared character cap.
 * @param result - the `runGit` result of a diff command.
 * @returns the (possibly cut) diff text and whether it had to be cut.
 */
function boundedDiff(result) {
  const truncated = result.overflow || result.out.length > DIFF_LIMIT_CHARS
  return { diff: truncated ? result.out.slice(0, DIFF_LIMIT_CHARS) : result.out, truncated }
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
  return boundedDiff(result)
}

/**
 * Shorten one `--decorate=full` refname to the name a badge shows.
 * @param value - full refname.
 * @returns the name with its `refs/heads/`, `refs/remotes/` or `refs/tags/` prefix removed.
 */
function shortRefName(value) {
  return value.replace(/^refs\/(?:heads|remotes|tags)\//, '').replace(/^refs\//, '')
}

/**
 * Classify one `--decorate=full` refname.
 * @param value - full refname.
 * @returns 'remote', 'tag' or 'local'.
 */
function refKindFor(value) {
  if (value.startsWith('refs/remotes/')) return 'remote'
  if (value.startsWith('refs/tags/')) return 'tag'
  return 'local'
}

/**
 * Parse the `%D` column of a `git log` record into reference badges.
 *
 * `--decorate=full` prints `HEAD -> refs/heads/main`, `tag: refs/tags/v1` and
 * bare refnames, joined with `, `; a detached HEAD is the word `HEAD` alone.
 * The branch HEAD points at is reported with kind `head`: a row shows one badge
 * per ref, and "HEAD is here" is the more useful of the two facts, while
 * `refs/remotes/origin/HEAD` stays a `remote` because it names a remote branch.
 *
 * @param decorations - the `%D` field, possibly empty.
 * @returns one `{ name, kind }` entry per decoration.
 */
function parseRefs(decorations) {
  const refs = []
  if (typeof decorations !== 'string' || decorations === '') return refs
  for (const part of decorations.split(/,\s+/)) {
    const entry = part.trim()
    if (entry === '') continue
    if (entry.startsWith('tag: ')) {
      refs.push({ name: shortRefName(entry.slice(5).trim()), kind: 'tag' })
      continue
    }
    if (entry === 'HEAD') {
      refs.push({ name: 'HEAD', kind: 'head' })
      continue
    }
    const head = /^HEAD -> (.+)$/.exec(entry)
    if (head !== null) {
      refs.push({ name: shortRefName(head[1]), kind: 'head' })
      continue
    }
    refs.push({ name: shortRefName(entry), kind: refKindFor(entry) })
  }
  return refs
}

/**
 * Build one commit row from its `LOG_FORMAT` columns.
 * @param fields - the eight log columns.
 * @returns the commit record sent to the Client half.
 */
function logCommit(fields) {
  return {
    hash: fields[0],
    short: fields[1],
    parents: fields[2] === '' ? [] : fields[2].split(' '),
    author: fields[3],
    email: fields[4],
    when: fields[5],
    subject: fields[6],
    refs: parseRefs(fields[7]),
  }
}

/**
 * Parse a `git log` body written in `LOG_FORMAT`.
 *
 * Records are separated by `RECORD_SEPARATOR` followed by a newline, so each
 * chunk is trimmed before its columns are split. A record shorter than eight
 * columns was cut in half by a buffer overflow and is dropped instead of being
 * reported with missing fields.
 *
 * @param text - raw stdout.
 * @returns the parsed commit rows, in git's order.
 */
function parseLog(text) {
  const commits = []
  for (const chunk of text.split(RECORD_SEPARATOR)) {
    const record = chunk.trim()
    if (record === '') continue
    const fields = record.split(FIELD_SEPARATOR)
    if (fields.length < 8) continue
    commits.push(logCommit(fields))
  }
  return commits
}

/**
 * Read one page of the commit graph.
 *
 * `--all` widens the log to every ref — that is what makes the graph show
 * branches that are not checked out. A `branch` filter replaces it with that
 * one revision, because the caller asked for a single line of history; an
 * `author` filter narrows whichever of the two it finds without changing what
 * is being walked. `--topo-order` keeps children above their parents so the
 * Client can draw lanes downward, and one record beyond the page size is what
 * tells whether another page exists.
 *
 * An unborn repository logs an empty history and exits 0, so a failing `git
 * log` inside a work tree is a filter git could not resolve, and outside one it
 * is a directory that is not a repository at all.
 *
 * @param dir - absolute directory, whether or not it is a repository.
 * @param limit - page size, already clamped.
 * @param filters - `{ branch, author }`, either null when that filter is off.
 * @returns `{ status, body }`; the body carries no `dir` or `filters`.
 */
async function readLog(dir, limit, filters) {
  const args = ['log']
  if (filters.branch === null) args.push('--all')
  else args.push(filters.branch)
  args.push('--topo-order', '--decorate=full', '-n', String(limit + 1), `--format=${LOG_FORMAT}`)
  if (filters.author !== null) args.push(`--author=${filters.author}`)
  const result = await runGit(dir, args, { trim: false })
  if (!result.ok && !result.overflow) {
    if (await insideWorkTree(dir)) {
      return {
        status: 400,
        body: {
          commits: [],
          hasMore: false,
          truncated: false,
          reason: filters.branch === null ? 'invalid-author' : 'unknown-ref',
          message: failureMessage(result),
        },
      }
    }
    return { status: 200, body: { commits: [], hasMore: false, truncated: false, reason: 'not-a-repository' } }
  }
  const commits = parseLog(result.out)
  const hasMore = commits.length > limit
  return {
    status: 200,
    body: {
      commits: hasMore ? commits.slice(0, limit) : commits,
      hasMore,
      truncated: result.overflow,
    },
  }
}

/**
 * Count commits per author across one `AUTHOR_FORMAT` listing.
 *
 * One line per commit, one candidate per name+email pair — a person who
 * committed under two addresses is two candidates, because the log filter
 * matches the ident, not the person. Sorting is by how much of the history
 * someone wrote, then by name so the order is stable across calls; the email
 * only breaks a tie between two candidates that share a name.
 *
 * @param text - `git log --format=%an%x1f%ae` output.
 * @returns `{ name, email, count }` per distinct author, most commits first.
 */
function parseAuthors(text) {
  const counts = new Map()
  for (const line of text.split('\n')) {
    if (line === '') continue
    const separator = line.indexOf(FIELD_SEPARATOR)
    const name = separator === -1 ? line : line.slice(0, separator)
    const email = separator === -1 ? '' : line.slice(separator + 1)
    const key = `${name}${FIELD_SEPARATOR}${email}`
    const counted = counts.get(key)
    if (counted === undefined) counts.set(key, { name, email, count: 1 })
    else counted.count += 1
  }
  return [...counts.values()].sort(compareAuthors)
}

/**
 * Order author candidates the way the history filter offers them.
 * @param left - first candidate.
 * @param right - second candidate.
 * @returns the sort order: most commits first, then name, then email.
 */
function compareAuthors(left, right) {
  return right.count - left.count || left.name.localeCompare(right.name) || left.email.localeCompare(right.email)
}

/**
 * Read every commit author in the repository's history.
 *
 * The history view filters commits by author, and a Client that only ever sees
 * one page of `/log` could only offer the authors who happen to be on that page
 * — a deep history would hide everyone older. So this walks the whole graph
 * once (`--all`, no branch filter) and aggregates here, which keeps the reply to
 * a few hundred rows instead of every commit.
 *
 * A directory that is not a repository degrades to an empty candidate list, the
 * same way the other read routes do.
 *
 * @param dir - absolute directory, whether or not it is a repository.
 * @returns up to `MAX_AUTHORS` candidates and whether any were cut.
 */
async function readAuthors(dir) {
  const result = await runGit(dir, ['log', '--all', `--format=${AUTHOR_FORMAT}`])
  if (!result.ok && !result.overflow) return { authors: [], truncated: false }
  // A buffer that overflowed ends mid-record, and half an ident would surface in
  // the filter as an author with a cut-off email; keep only whole lines.
  const text = result.overflow ? result.out.slice(0, result.out.lastIndexOf('\n') + 1) : result.out
  const authors = parseAuthors(text)
  return { authors: authors.slice(0, MAX_AUTHORS), truncated: result.overflow || authors.length > MAX_AUTHORS }
}

/**
 * The post-change path of a `--numstat` path column.
 *
 * A rename prints `old => new`, or `pre{a => b}post` when the two paths share a
 * prefix and a suffix. Both forms are collapsed onto the path the file has in
 * this commit, which is the path `--name-status` reports, so the two commands
 * can be joined.
 *
 * @param value - the third tab-separated column of a numstat line.
 * @returns the path after the change.
 */
function numstatPath(value) {
  const braced = /\{(.*?) => (.*?)\}/.exec(value)
  if (braced !== null) return value.replace(braced[0], braced[2])
  const parts = value.split(' => ')
  return parts.length === 2 ? parts[1] : value
}

/**
 * Parse the `--numstat` half of a `git show` reply.
 * @param text - everything git printed after the commit record.
 * @returns a map from path to its line counts; `binary` is set for `-`/`-`.
 */
function parseNumstat(text) {
  const stats = new Map()
  for (const line of text.split('\n')) {
    if (line === '') continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const path = numstatPath(parts.slice(2).join('\t'))
    if (path === '') continue
    const binary = parts[0] === '-' && parts[1] === '-'
    const additions = Number(parts[0])
    const deletions = Number(parts[1])
    stats.set(path, {
      binary,
      additions: binary || !Number.isFinite(additions) ? 0 : additions,
      deletions: binary || !Number.isFinite(deletions) ? 0 : deletions,
    })
  }
  return stats
}

/**
 * Parse `--name-status` output into status rows.
 * @param text - raw stdout, one `<letter>\t<path>` (or `<letter>\t<old>\t<new>`) per line.
 * @returns one `{ path, status }` row per file, `path` being the post-change path
 *   and `status` the single letter git printed.
 */
function parseNameStatus(text) {
  const files = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    const parts = line.split('\t')
    const letter = (parts[0] ?? '')[0]
    if (letter === undefined || letter === '') continue
    const renamed = letter === 'R' || letter === 'C'
    const path = renamed ? parts[2] ?? parts[1] ?? '' : parts[1] ?? ''
    if (path === '') continue
    files.push({ path, status: letter })
  }
  return files
}

/**
 * Describe one commit and the files it touched.
 *
 * `git show --numstat` carries the line counts and `git diff-tree
 * --name-status` the one-letter status; the two are joined on the path the file
 * has after the change. A path `--numstat` does not mention — a merge commit,
 * whose `--name-status` output is empty anyway — keeps 0/0 and is not binary.
 *
 * @param dir - absolute directory.
 * @param hash - 4..40 hex digits, already validated.
 * @returns `{ commit }` on success, or `{ failure }` holding git's own message.
 */
async function readCommit(dir, hash) {
  const [shown, named] = await Promise.all([
    runGit(dir, ['show', '--no-ext-diff', `--format=${COMMIT_FORMAT}`, '--numstat', hash], { trim: false }),
    runGit(dir, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', hash]),
  ])
  if (!shown.ok && !shown.overflow) return { failure: failureMessage(shown) }
  if (!named.ok) return { failure: failureMessage(named) }
  const cut = shown.out.indexOf(RECORD_SEPARATOR)
  const header = cut === -1 ? shown.out : shown.out.slice(0, cut)
  const fields = header.split(FIELD_SEPARATOR)
  if (fields.length < 8) return { failure: 'git returned an unreadable commit record' }
  const stats = parseNumstat(cut === -1 ? '' : shown.out.slice(cut + 1))
  const rows = parseNameStatus(named.out)
  const files = rows.slice(0, MAX_COMMIT_FILES).map((row) => {
    const lines = stats.get(row.path)
    return {
      path: row.path,
      status: row.status,
      additions: lines?.additions ?? 0,
      deletions: lines?.deletions ?? 0,
      binary: lines?.binary ?? false,
    }
  })
  return {
    commit: {
      hash: fields[0],
      short: fields[1],
      parents: fields[2] === '' ? [] : fields[2].split(' '),
      author: fields[3],
      email: fields[4],
      when: fields[5],
      subject: fields[6],
      body: (fields[7] ?? '').trim(),
      files,
      truncated: rows.length > MAX_COMMIT_FILES || shown.overflow || named.overflow,
    },
  }
}

/**
 * Read one file's diff inside one commit.
 *
 * `--format=` drops the commit header so the reply is a plain unified diff,
 * which is what the Client's per-file viewer renders.
 *
 * @param dir - absolute directory.
 * @param hash - 4..40 hex digits, already validated.
 * @param path - repository-relative path, already validated.
 * @returns `{ diff, truncated }`, or `{ failure }` holding git's own message.
 */
async function readCommitDiff(dir, hash, path) {
  const result = await runGit(dir, ['show', '--format=', '--no-ext-diff', '--unified=3', hash, '--', path], {
    trim: false,
  })
  if (!result.ok && !result.overflow) return { failure: failureMessage(result) }
  return boundedDiff(result)
}

/**
 * Ask git whether a directory belongs to a work tree.
 *
 * Used only after a command failed, to tell "this is not a repository" (a
 * degraded answer) from "this revision does not exist" (a 404).
 *
 * @param dir - absolute directory.
 * @returns true when git commands there can resolve revisions.
 */
async function insideWorkTree(dir) {
  const result = await runGit(dir, ['rev-parse', '--is-inside-work-tree'])
  return result.ok && result.out === 'true'
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
 * Mount the eleven routes.
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
        path: ROUTE_WORKTREES,
        handler: (req, res) =>
          serveGet(ctx, req, res, 'worktrees-failed', async (dir) => {
            const described = await readWorktrees(dir)
            return {
              status: 200,
              body:
                described === null
                  ? { dir, reason: 'not-a-repository', worktrees: [] }
                  : { dir, root: described.root, worktrees: described.worktrees },
            }
          }),
      }),
    `git-bar: GET ${ROUTE_WORKTREES}`,
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

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_LOG,
        handler: (req, res) =>
          serveGet(ctx, req, res, 'log-failed', async (dir, url) => {
            const filters = { branch: filterValue(url, 'branch'), author: filterValue(url, 'author') }
            if (filters.branch !== null && !validBranchFilter(filters.branch)) {
              return { status: 400, body: { error: 'invalid-branch' } }
            }
            if (filters.author !== null && !validAuthorFilter(filters.author)) {
              return { status: 400, body: { error: 'invalid-author' } }
            }
            const page = await readLog(dir, parseLimit(url), filters)
            return { status: page.status, body: { dir, ...page.body, filters } }
          }),
      }),
    `git-bar: GET ${ROUTE_LOG}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_COMMIT,
        handler: (req, res) =>
          serveGet(ctx, req, res, 'commit-failed', async (dir, url) => {
            const hash = url.searchParams.get('hash') ?? ''
            if (!validHash(hash)) return { status: 400, body: { error: 'invalid-hash' } }
            const described = await readCommit(dir, hash)
            if (described.commit !== undefined) return { status: 200, body: { dir, ...described.commit } }
            // Outside a repository git's complaint is "not a git repository",
            // which is a degraded answer about the directory, not an unknown commit.
            if (!(await insideWorkTree(dir))) {
              return { status: 200, body: { dir, reason: 'not-a-repository', files: [], truncated: false } }
            }
            return { status: 404, body: { error: 'unknown-commit', message: described.failure } }
          }),
      }),
    `git-bar: GET ${ROUTE_COMMIT}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_COMMIT_DIFF,
        handler: (req, res) =>
          serveGet(ctx, req, res, 'commit-diff-failed', async (dir, url) => {
            const hash = url.searchParams.get('hash') ?? ''
            const path = url.searchParams.get('path') ?? ''
            if (!validHash(hash)) return { status: 400, body: { error: 'invalid-hash' } }
            if (!validCommitPath(path)) return { status: 400, body: { error: 'invalid-path' } }
            const described = await readCommitDiff(dir, hash, path)
            if (described.diff !== undefined) {
              return {
                status: 200,
                body: { dir, hash, path, diff: described.diff, truncated: described.truncated },
              }
            }
            if (!(await insideWorkTree(dir))) {
              return { status: 200, body: { dir, reason: 'not-a-repository', diff: '', truncated: false } }
            }
            return { status: 404, body: { error: 'unknown-commit', message: described.failure } }
          }),
      }),
    `git-bar: GET ${ROUTE_COMMIT_DIFF}`,
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_AUTHORS,
        handler: (req, res) =>
          serveGet(ctx, req, res, 'authors-failed', async (dir) => ({
            status: 200,
            body: { dir, ...(await readAuthors(dir)) },
          })),
      }),
    `git-bar: GET ${ROUTE_AUTHORS}`,
  )
}
