import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { apply, name, inject } from '../index.js'

const GIT = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const IDENTITY = ['-c', 'user.name=t', '-c', 'user.email=t@t']

function makeRepo(root, { commit = true } = {}) {
  mkdirSync(root, { recursive: true })
  GIT(root, 'init', '-q', '-b', 'main')
  if (commit) {
    writeFileSync(join(root, 'a.txt'), 'one\n')
    GIT(root, 'add', 'a.txt')
    GIT(root, ...IDENTITY, 'commit', '-q', '-m', 'first')
  }
  return root
}

const base = mkdtempSync(join(tmpdir(), 'gitbar-'))
const repo = makeRepo(join(base, 'repo'))
const plain = join(base, 'plain'); mkdirSync(plain)
const borrowed = makeRepo(join(base, 'borrowed'))
// dirty: modify tracked + add untracked
writeFileSync(join(repo, 'a.txt'), 'two\n')
writeFileSync(join(repo, 'b.txt'), 'new\n')
// linked worktree of `borrowed`
const wt = join(base, 'borrowed-wt')
GIT(borrowed, 'worktree', 'add', '-q', '-b', 'worktree-test', wt)

let rejection
let connected = true
let sessions = {}
const routes = []
const effects = []
const ctx = {
  get(service) {
    if (service === 'connection') return connected ? { requestRejection: () => rejection } : undefined
    if (service === 'sessions') return { get: (id) => sessions[id] }
    return undefined
  },
  effect(fn, label) { effects.push(label); const disposer = fn(); return disposer },
  webServer: { register(route) { routes.push(route); return () => {} } },
}

apply(ctx)
assert.equal(name, 'dsh-git-bar')
assert.deepEqual(inject, ['webServer'])
assert.equal(routes.length, 11)
assert.ok(routes.every((route) => route.kind === 'exact'))
assert.deepEqual(routes.map((route) => route.path), [
  '/dsh-git-bar/info',
  '/dsh-git-bar/branches',
  '/dsh-git-bar/worktrees',
  '/dsh-git-bar/changes',
  '/dsh-git-bar/diff',
  '/dsh-git-bar/branches/checkout',
  '/dsh-git-bar/branches/create',
  '/dsh-git-bar/log',
  '/dsh-git-bar/commit',
  '/dsh-git-bar/commit-diff',
  '/dsh-git-bar/authors',
])
assert.deepEqual(effects, [
  'git-bar: GET /dsh-git-bar/info',
  'git-bar: GET /dsh-git-bar/branches',
  'git-bar: GET /dsh-git-bar/worktrees',
  'git-bar: GET /dsh-git-bar/changes',
  'git-bar: GET /dsh-git-bar/diff',
  'git-bar: POST /dsh-git-bar/branches/checkout',
  'git-bar: POST /dsh-git-bar/branches/create',
  'git-bar: GET /dsh-git-bar/log',
  'git-bar: GET /dsh-git-bar/commit',
  'git-bar: GET /dsh-git-bar/commit-diff',
  'git-bar: GET /dsh-git-bar/authors',
])
const handlers = new Map(routes.map((route) => [route.path, route.handler]))

function response() {
  return { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(chunk) { if (chunk !== undefined) this.body += chunk } }
}

async function call(url, { method = 'GET', body, headers } = {}) {
  const routePath = url.split('?')[0]
  const handler = handlers.get(routePath)
  assert.ok(handler !== undefined, `no route registered for ${routePath}`)
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  const req = {
    method,
    url,
    headers: { 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() {
      if (text !== '') yield Buffer.from(text, 'utf8')
    },
  }
  const res = response()
  await handler(req, res)
  let json
  try { json = JSON.parse(res.body) } catch { json = undefined }
  return { status: res.statusCode, headers: res.headers, json, body: res.body }
}

const dirParam = (dir) => encodeURIComponent(dir)

// 1. dirty repository via explicit dir
let r = await call(`/dsh-git-bar/info?dir=${dirParam(repo)}`)
assert.equal(r.status, 200)
assert.equal(r.json.repository.name, 'repo')
assert.equal(r.json.repository.branch, 'main')
assert.equal(r.json.repository.detached, false)
assert.equal(r.json.repository.dirty.changed, 2)
assert.equal(r.json.repository.dirty.untracked, 1)
assert.equal(r.json.repository.dirty.staged, 0)
assert.equal(r.json.repository.dirty.unstaged, 1)
assert.match(r.json.repository.sha, /^[0-9a-f]{7,}$/)
assert.equal(r.json.repository.worktree.linked, false)
assert.equal(r.json.repository.worktree.count, 1)
console.log('1 repo dirty OK', JSON.stringify(r.json.repository.dirty))

// 2. clean repository has zero changes
r = await call(`/dsh-git-bar/info?dir=${dirParam(borrowed)}`)
assert.equal(r.json.repository.dirty.changed, 0)
assert.equal(r.json.repository.worktree.linked, false)
console.log('2 clean OK')

// 3. linked worktree is reported as such, on its own branch
r = await call(`/dsh-git-bar/info?dir=${dirParam(wt)}`)
assert.equal(r.json.repository.branch, 'worktree-test')
assert.equal(r.json.repository.worktree.linked, true)
assert.equal(r.json.repository.worktree.mainRoot, realpathSync(borrowed))
assert.equal(r.json.repository.worktree.count, 2)
console.log('3 linked worktree OK', r.json.repository.branch, r.json.repository.worktree)

// 4. non-repository directory
r = await call(`/dsh-git-bar/info?dir=${dirParam(plain)}`)
assert.equal(r.status, 200)
assert.equal(r.json.repository, null)
assert.equal(r.json.reason, 'not-a-repository')
console.log('4 not-a-repository OK')

// 5. session id wins over the client hint
sessions = { 'session-1': { header: { cwd: repo } } }
r = await call('/dsh-git-bar/info?sessionId=session-1&dir=/definitely/not/this')
assert.equal(r.json.dir, repo)
assert.equal(r.json.repository.name, 'repo')
console.log('5 session resolution OK')

// 6. unknown session falls back to the hint
sessions = {}
r = await call(`/dsh-git-bar/info?sessionId=missing&dir=${dirParam(repo)}`)
assert.equal(r.json.dir, repo)
console.log('6 session fallback OK')

// 7. no directory at all
r = await call('/dsh-git-bar/info')
assert.equal(r.status, 400)
assert.equal(r.json.error, 'no-directory')
console.log('7 no-directory OK')

// 8. relative dir is refused
r = await call('/dsh-git-bar/info?dir=relative/path')
assert.equal(r.status, 400)
console.log('8 relative path refused OK')

// 9. method guard
r = await call(`/dsh-git-bar/info?dir=${dirParam(repo)}`, { method: 'POST' })
assert.equal(r.status, 405)
assert.equal(r.headers.allow, 'GET')
console.log('9 method guard OK')

// 10. unauthenticated request is rejected and leaks nothing
rejection = 401
r = await call(`/dsh-git-bar/info?dir=${dirParam(repo)}`)
assert.equal(r.status, 401)
assert.equal(r.body, '')
console.log('10 auth rejection OK')
rejection = undefined

// 11. detached HEAD
const detached = makeRepo(join(base, 'detached'))
GIT(detached, 'checkout', '-q', '--detach')
r = await call(`/dsh-git-bar/info?dir=${dirParam(detached)}`)
assert.equal(r.json.repository.branch, null)
assert.equal(r.json.repository.detached, true)
console.log('11 detached HEAD OK', r.json.repository.sha)

// 12. unborn repository (no commits) degrades instead of failing
const unborn = makeRepo(join(base, 'unborn'), { commit: false })
r = await call(`/dsh-git-bar/info?dir=${dirParam(unborn)}`)
assert.equal(r.status, 200)
assert.equal(r.json.repository.root.endsWith('unborn'), true)
assert.equal(r.json.repository.sha, null)
console.log('12 unborn repo OK', r.json.repository.branch, r.json.repository.sha)

// ---------------------------------------------------------------------------
// branches
// ---------------------------------------------------------------------------

// 13. branch list: current first, the rest by name, tracking state included
const flow = makeRepo(join(base, 'flow'))
GIT(flow, 'branch', 'zeta')
GIT(flow, 'branch', 'alpha')
GIT(flow, 'branch', 'middle')
r = await call(`/dsh-git-bar/branches?dir=${dirParam(flow)}`)
assert.equal(r.status, 200)
assert.equal(r.json.dir, flow)
assert.equal(r.json.reason, undefined)
assert.equal(r.json.repository.name, 'flow')
assert.deepEqual(r.json.branches.map((branch) => branch.name), ['main', 'alpha', 'middle', 'zeta'])
assert.deepEqual(r.json.branches.map((branch) => branch.current), [true, false, false, false])
assert.deepEqual(r.json.branches[0], {
  name: 'main',
  current: true,
  upstream: null,
  ahead: 0,
  behind: 0,
  subject: 'first',
  checkedOutIn: realpathSync(flow),
})
assert.deepEqual(r.json.dirty, { changed: 0, staged: 0, unstaged: 0, untracked: 0 })
console.log('13 branch list OK', r.json.branches.map((branch) => branch.name).join(','))

// 14. ahead/behind against a real upstream, and a broken upstream degrades to 0/0
const origin = join(base, 'origin.git')
mkdirSync(origin)
GIT(origin, 'init', '-q', '--bare')
const tracked = makeRepo(join(base, 'tracked'))
GIT(tracked, 'remote', 'add', 'origin', origin)
GIT(tracked, 'push', '-q', '-u', 'origin', 'main')
writeFileSync(join(tracked, 'a.txt'), 'ahead\n')
GIT(tracked, ...IDENTITY, 'commit', '-q', '-am', 'second')
GIT(tracked, 'branch', 'ghost')
GIT(tracked, 'config', 'branch.ghost.remote', 'origin')
GIT(tracked, 'config', 'branch.ghost.merge', 'refs/heads/does-not-exist')
r = await call(`/dsh-git-bar/branches?dir=${dirParam(tracked)}`)
assert.equal(r.status, 200)
const trackedMain = r.json.branches.find((branch) => branch.name === 'main')
const trackedGhost = r.json.branches.find((branch) => branch.name === 'ghost')
assert.equal(trackedMain.upstream, 'origin/main')
assert.equal(trackedMain.ahead, 1)
assert.equal(trackedMain.behind, 0)
assert.equal(trackedMain.subject, 'second')
assert.equal(trackedGhost.upstream, 'origin/does-not-exist')
assert.equal(trackedGhost.ahead, 0)
assert.equal(trackedGhost.behind, 0)
console.log('14 upstream counts OK', trackedMain.ahead, trackedMain.behind)

// 15. branches outside a repository
r = await call(`/dsh-git-bar/branches?dir=${dirParam(plain)}`)
assert.equal(r.status, 200)
assert.equal(r.json.repository, null)
assert.equal(r.json.reason, 'not-a-repository')
assert.deepEqual(r.json.branches, [])
assert.deepEqual(r.json.dirty, { changed: 0, staged: 0, unstaged: 0, untracked: 0 })
console.log('15 branches not-a-repository OK')

// ---------------------------------------------------------------------------
// creating and switching branches
// ---------------------------------------------------------------------------

// 16. create from HEAD, then create from an explicit ref
r = await call('/dsh-git-bar/branches/create', { method: 'POST', body: { dir: flow, name: 'feature-x' } })
assert.equal(r.status, 200)
assert.deepEqual(r.json, { branch: 'feature-x', created: true })
assert.equal(GIT(flow, 'symbolic-ref', '--short', 'HEAD').trim(), 'feature-x')
const mainSha = GIT(flow, 'rev-parse', 'main').trim()
r = await call('/dsh-git-bar/branches/create', {
  method: 'POST',
  body: { sessionId: 'missing', dir: flow, name: 'feature-y', from: 'main' },
})
assert.equal(r.status, 200)
assert.deepEqual(r.json, { branch: 'feature-y', created: true })
assert.equal(GIT(flow, 'rev-parse', 'feature-y').trim(), mainSha)
console.log('16 create OK')

// 17. create refuses an invalid name, for either field
r = await call('/dsh-git-bar/branches/create', { method: 'POST', body: { dir: flow, name: 'bad..name' } })
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'invalid-branch' })
r = await call('/dsh-git-bar/branches/create', { method: 'POST', body: { dir: flow, name: 'topic', from: 'HEAD~1' } })
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'invalid-branch' })
console.log('17 create invalid name OK')

// 18. checkout happy path, resolving the directory from the Session store
GIT(flow, 'checkout', '-q', 'main')
sessions = { 'session-flow': { header: { cwd: flow } } }
r = await call('/dsh-git-bar/branches/checkout', {
  method: 'POST',
  body: { sessionId: 'session-flow', dir: '/definitely/not/this', branch: 'alpha' },
})
assert.equal(r.status, 200)
assert.deepEqual(r.json, { branch: 'alpha', created: false })
assert.equal(GIT(flow, 'symbolic-ref', '--short', 'HEAD').trim(), 'alpha')
sessions = {}
console.log('18 checkout OK')

// 19. checkout refuses an invalid name
r = await call('/dsh-git-bar/branches/checkout', { method: 'POST', body: { dir: flow, branch: '-x' } })
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'invalid-branch' })
r = await call('/dsh-git-bar/branches/checkout', { method: 'POST', body: { dir: flow } })
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'invalid-branch' })
console.log('19 checkout invalid name OK')

// 20. checkout git refuses: a conflicting local change is reported, not thrown
const conflict = makeRepo(join(base, 'conflict'))
GIT(conflict, 'checkout', '-q', '-b', 'other')
writeFileSync(join(conflict, 'a.txt'), 'other\n')
GIT(conflict, ...IDENTITY, 'commit', '-q', '-am', 'other')
GIT(conflict, 'checkout', '-q', 'main')
writeFileSync(join(conflict, 'a.txt'), 'dirty\n')
r = await call('/dsh-git-bar/branches/checkout', { method: 'POST', body: { dir: conflict, branch: 'other' } })
assert.equal(r.status, 409)
assert.equal(r.json.error, 'checkout-refused')
assert.match(r.json.message, /overwritten|local changes/i)
assert.ok(r.json.message.length <= 400)
assert.equal(GIT(conflict, 'symbolic-ref', '--short', 'HEAD').trim(), 'main')
console.log('20 checkout refused OK')

// ---------------------------------------------------------------------------
// changed files
// ---------------------------------------------------------------------------

// 21. changes: rename, untracked, staged and unstaged edits, per-side line counts
const changed = makeRepo(join(base, 'changed'))
writeFileSync(join(changed, 'keep.txt'), 'k\n')
writeFileSync(join(changed, 'del.txt'), 'd\n')
GIT(changed, 'add', 'keep.txt', 'del.txt')
GIT(changed, ...IDENTITY, 'commit', '-q', '-m', 'base')
GIT(changed, 'mv', 'a.txt', 'renamed.txt')
writeFileSync(join(changed, 'keep.txt'), 'k2\n')
writeFileSync(join(changed, 'del.txt'), 'e\n')
GIT(changed, 'add', 'del.txt')
writeFileSync(join(changed, 'added.txt'), 'x\ny\n')
GIT(changed, 'add', 'added.txt')
writeFileSync(join(changed, 'u.txt'), 'u\n')
r = await call(`/dsh-git-bar/changes?dir=${dirParam(changed)}`)
assert.equal(r.status, 200)
assert.equal(r.json.dir, changed)
assert.deepEqual(r.json.dirty, { changed: 5, staged: 3, unstaged: 1, untracked: 1 })
const byPath = new Map(r.json.files.map((file) => [file.path, file]))
assert.deepEqual([...byPath.keys()].sort(), ['added.txt', 'del.txt', 'keep.txt', 'renamed.txt', 'u.txt'])
assert.deepEqual(byPath.get('added.txt'), { path: 'added.txt', status: 'A', staged: true, additions: 2, deletions: 0 })
assert.deepEqual(byPath.get('del.txt'), { path: 'del.txt', status: 'M', staged: true, additions: 1, deletions: 1 })
assert.deepEqual(byPath.get('keep.txt'), { path: 'keep.txt', status: 'M', staged: false, additions: 1, deletions: 1 })
assert.deepEqual(byPath.get('renamed.txt'), { path: 'renamed.txt', status: 'R', staged: true, additions: 1, deletions: 0 })
assert.deepEqual(byPath.get('u.txt'), { path: 'u.txt', status: '?', staged: false, additions: null, deletions: null })
console.log('21 changes OK', r.json.dirty)

// 22. changes outside a repository is an error slug, not a crash
r = await call(`/dsh-git-bar/changes?dir=${dirParam(plain)}`)
assert.equal(r.status, 500)
assert.equal(r.json.error, 'changes-failed')
assert.ok(typeof r.json.message === 'string')
console.log('22 changes outside repo OK')

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

// 23. unstaged diff
r = await call(`/dsh-git-bar/diff?dir=${dirParam(changed)}&path=keep.txt`)
assert.equal(r.status, 200)
assert.equal(r.json.path, 'keep.txt')
assert.equal(r.json.staged, false)
assert.equal(r.json.truncated, false)
assert.match(r.json.diff, /^-k$/m)
assert.match(r.json.diff, /^\+k2$/m)
assert.equal(r.json.diff.includes('\u001b['), false)
console.log('23 unstaged diff OK')

// 24. staged diff, and the same path on the other side is empty
r = await call(`/dsh-git-bar/diff?dir=${dirParam(changed)}&path=del.txt&staged=1`)
assert.equal(r.status, 200)
assert.equal(r.json.staged, true)
assert.match(r.json.diff, /^\+e$/m)
r = await call(`/dsh-git-bar/diff?dir=${dirParam(changed)}&path=del.txt&staged=0`)
assert.equal(r.status, 200)
assert.equal(r.json.diff, '')
console.log('24 staged diff OK')

// 24b. an untracked file diffs against /dev/null, a tracked clean one stays empty
writeFileSync(join(changed, 'fresh.txt'), 'brand new\n')
r = await call(`/dsh-git-bar/diff?dir=${dirParam(changed)}&path=fresh.txt`)
assert.equal(r.status, 200)
assert.match(r.json.diff, /^\+brand new$/m)
assert.equal(r.json.diff.includes('\u001b['), false)
console.log('24b untracked diff OK')

// 25. diff path validation
for (const bad of ['/etc/passwd', '../a.txt', 'a/../a.txt', '']) {
  r = await call(`/dsh-git-bar/diff?dir=${dirParam(changed)}&path=${dirParam(bad)}`)
  assert.equal(r.status, 400, `expected 400 for path ${JSON.stringify(bad)}`)
  assert.deepEqual(r.json, { error: 'invalid-path' })
}
r = await call(`/dsh-git-bar/diff?dir=${dirParam(changed)}`)
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'invalid-path' })
console.log('25 diff path validation OK')

// 26. a diff larger than the cap is truncated and flagged
const big = join(base, 'big')
mkdirSync(big, { recursive: true })
GIT(big, 'init', '-q', '-b', 'main')
const line = (char) => `${char.repeat(20)}\n`
writeFileSync(join(big, 'big.txt'), line('a').repeat(5000))
GIT(big, 'add', 'big.txt')
GIT(big, ...IDENTITY, 'commit', '-q', '-m', 'big')
writeFileSync(join(big, 'big.txt'), line('b').repeat(5000))
r = await call(`/dsh-git-bar/diff?dir=${dirParam(big)}&path=big.txt`)
assert.equal(r.status, 200)
assert.equal(r.json.truncated, true)
assert.equal(r.json.diff.length, 200_000)
console.log('26 diff truncation OK', r.json.diff.length)

// 27. a diff past the git buffer is still a cut diff, not a failure
const huge = join(base, 'huge')
mkdirSync(huge, { recursive: true })
GIT(huge, 'init', '-q', '-b', 'main')
writeFileSync(join(huge, 'huge.txt'), line('a').repeat(30000))
GIT(huge, 'add', 'huge.txt')
GIT(huge, ...IDENTITY, 'commit', '-q', '-m', 'huge')
writeFileSync(join(huge, 'huge.txt'), line('b').repeat(30000))
r = await call(`/dsh-git-bar/diff?dir=${dirParam(huge)}&path=huge.txt`)
assert.equal(r.status, 200)
assert.equal(r.json.truncated, true)
assert.equal(r.json.diff.length, 200_000)
console.log('27 diff overflow truncation OK', r.json.diff.length)

// ---------------------------------------------------------------------------
// shared guards
// ---------------------------------------------------------------------------

// 28. method guards on every new route
r = await call(`/dsh-git-bar/branches?dir=${dirParam(flow)}`, { method: 'POST' })
assert.equal(r.status, 405)
assert.equal(r.headers.allow, 'GET')
r = await call(`/dsh-git-bar/changes?dir=${dirParam(flow)}`, { method: 'POST' })
assert.equal(r.status, 405)
assert.equal(r.headers.allow, 'GET')
r = await call(`/dsh-git-bar/diff?dir=${dirParam(flow)}&path=a.txt`, { method: 'POST' })
assert.equal(r.status, 405)
assert.equal(r.headers.allow, 'GET')
r = await call('/dsh-git-bar/branches/checkout')
assert.equal(r.status, 405)
assert.equal(r.headers.allow, 'POST')
r = await call('/dsh-git-bar/branches/create')
assert.equal(r.status, 405)
assert.equal(r.headers.allow, 'POST')
console.log('28 method guards OK')

// 29. unusable POST bodies
r = await call('/dsh-git-bar/branches/checkout', { method: 'POST', body: 'not json' })
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'invalid-body' })
r = await call('/dsh-git-bar/branches/checkout', { method: 'POST', body: '[]' })
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'invalid-body' })
r = await call('/dsh-git-bar/branches/create', { method: 'POST', body: JSON.stringify({ blob: 'x'.repeat(9000) }) })
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'invalid-body' })
r = await call('/dsh-git-bar/branches/checkout', {
  method: 'POST',
  headers: { 'content-type': 'text/plain' },
  body: { dir: flow, branch: 'main' },
})
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'invalid-body' })
console.log('29 invalid body OK')

// 30. POST directory resolution failures, and the auth gate on a POST route
r = await call('/dsh-git-bar/branches/checkout', { method: 'POST', body: {} })
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'no-directory' })
r = await call('/dsh-git-bar/branches/checkout', {
  method: 'POST',
  body: { sessionId: 'missing', dir: 'relative/path', branch: 'main' },
})
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'no-directory' })
rejection = 401
r = await call('/dsh-git-bar/branches/create', { method: 'POST', body: { dir: flow, name: 'nope' } })
assert.equal(r.status, 401)
assert.equal(r.body, '')
rejection = undefined
console.log('30 POST guards OK')

// 31. a Session that does not exist never widens access: only absolute hints survive
r = await call('/dsh-git-bar/branches?sessionId=missing&dir=relative')
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'no-directory' })
console.log('31 no-directory on branches OK')

// 32. without the connection service every route answers 503 before touching git
connected = false
r = await call(`/dsh-git-bar/branches?dir=${dirParam(flow)}`)
assert.equal(r.status, 503)
assert.deepEqual(r.json, { error: 'no-connection' })
r = await call('/dsh-git-bar/branches/checkout', { method: 'POST', body: { dir: flow, branch: 'main' } })
assert.equal(r.status, 503)
assert.deepEqual(r.json, { error: 'no-connection' })
connected = true
console.log('32 no-connection OK')

// 33. every worktree of the repository is described, main and current flagged
const mainPath = realpathSync(borrowed)
const wtPath = realpathSync(wt)
r = await call(`/dsh-git-bar/worktrees?dir=${dirParam(borrowed)}`)
assert.equal(r.status, 200)
assert.equal(r.json.worktrees.length, 2)
const [mainEntry, linkedEntry] = r.json.worktrees
assert.equal(mainEntry.path, mainPath)
assert.equal(mainEntry.main, true)
assert.equal(mainEntry.current, true)
assert.equal(linkedEntry.path, wtPath)
assert.equal(linkedEntry.name, 'borrowed-wt')
assert.equal(linkedEntry.branch, 'worktree-test')
assert.equal(linkedEntry.main, false)
assert.equal(linkedEntry.current, false)
assert.equal(linkedEntry.dirty.changed, 0)
console.log('33 worktrees listed OK')

// 34. the current worktree follows the directory, and changes are read per worktree
writeFileSync(join(wt, 'wt-dirty.txt'), 'changed in the worktree\n')
r = await call(`/dsh-git-bar/worktrees?dir=${dirParam(wt)}`)
const linkedNow = r.json.worktrees.find((entry) => entry.path === wtPath)
const mainNow = r.json.worktrees.find((entry) => entry.path === mainPath)
assert.equal(linkedNow.current, true)
assert.equal(linkedNow.main, false)
assert.equal(linkedNow.dirty.changed, 1)
assert.equal(mainNow.current, false)
assert.equal(mainNow.dirty.changed, 0)
console.log('34 per-worktree changes OK', linkedNow.dirty.changed)

// 35. a branch checked out in another worktree names that worktree
r = await call(`/dsh-git-bar/branches?dir=${dirParam(wt)}`)
const byName = new Map(r.json.branches.map((branch) => [branch.name, branch]))
assert.equal(byName.get('worktree-test').checkedOutIn, wtPath)
assert.equal(byName.get('worktree-test').current, true)
assert.equal(byName.get('main').checkedOutIn, mainPath)
assert.equal(byName.get('main').current, false)
console.log('35 checkedOutIn OK')

// 36. outside a repository the worktree route answers with no list
r = await call(`/dsh-git-bar/worktrees?dir=${dirParam(plain)}`)
assert.equal(r.status, 200)
assert.deepEqual(r.json, { dir: plain, reason: 'not-a-repository', worktrees: [] })
console.log('36 worktrees outside a repository OK')

// 37. the short sha carries a commit URL derived from the origin remote
const hosted = makeRepo(join(base, 'hosted'))
GIT(hosted, 'remote', 'add', 'origin', 'git@github.com:owner/repo.git')
const hostedSha = GIT(hosted, 'rev-parse', 'HEAD').trim()
r = await call(`/dsh-git-bar/info?dir=${dirParam(hosted)}`)
assert.equal(r.json.repository.commitUrl, `https://github.com/owner/repo/commit/${hostedSha}`)
assert.deepEqual(r.json.repository.remote, { url: 'git@github.com:owner/repo.git', webUrl: 'https://github.com/owner/repo' })
console.log('37 github commit URL OK', r.json.repository.commitUrl)

// 38. https and ssh remotes normalize; GitLab keeps its own commit route
GIT(hosted, 'remote', 'set-url', 'origin', 'https://gitlab.example.com/group/sub/repo.git')
r = await call(`/dsh-git-bar/info?dir=${dirParam(hosted)}`)
assert.equal(r.json.repository.commitUrl, `https://gitlab.example.com/group/sub/repo/-/commit/${hostedSha}`)
assert.equal(r.json.repository.remote.webUrl, 'https://gitlab.example.com/group/sub/repo')
GIT(hosted, 'remote', 'set-url', 'origin', 'ssh://git@git.example.com:2222/team/project.git')
r = await call(`/dsh-git-bar/info?dir=${dirParam(hosted)}`)
assert.equal(r.json.repository.remote.webUrl, 'https://git.example.com:2222/team/project')
assert.equal(r.json.repository.commitUrl, `https://git.example.com:2222/team/project/commit/${hostedSha}`)
console.log('38 remote normalization OK')

// 39. a remote with no browsing URL, and no remote at all, stay unlinked
GIT(hosted, 'remote', 'set-url', 'origin', join(base, 'somewhere.git'))
r = await call(`/dsh-git-bar/info?dir=${dirParam(hosted)}`)
assert.equal(r.json.repository.remote.webUrl, null)
assert.equal(r.json.repository.commitUrl, null)
GIT(hosted, 'remote', 'remove', 'origin')
r = await call(`/dsh-git-bar/info?dir=${dirParam(hosted)}`)
assert.equal(r.json.repository.remote, null)
assert.equal(r.json.repository.commitUrl, null)
console.log('39 unlinked remotes OK')

// ---------------------------------------------------------------------------
// git history: log, commit, commit-diff
// ---------------------------------------------------------------------------

// 40. log lists every commit newest first, and the branch HEAD sits on carries a head badge
const history = makeRepo(join(base, 'history'))
writeFileSync(join(history, 'a.txt'), 'one\ntwo\n')
GIT(history, ...IDENTITY, 'commit', '-q', '-am', 'second')
const historySecond = GIT(history, 'rev-parse', 'HEAD').trim()
const historyFirst = GIT(history, 'rev-parse', 'HEAD~1').trim()
r = await call(`/dsh-git-bar/log?dir=${dirParam(history)}`)
assert.equal(r.status, 200)
assert.equal(r.json.dir, history)
assert.equal(r.json.commits.length, 2)
assert.equal(r.json.commits[0].hash, historySecond)
assert.equal(r.json.commits[1].hash, historyFirst)
assert.equal(r.json.commits[0].subject, 'second')
assert.equal(r.json.commits[0].author, 't')
assert.equal(r.json.commits[0].email, 't@t')
assert.match(r.json.commits[0].when, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
assert.ok(historySecond.startsWith(r.json.commits[0].short))
assert.deepEqual(r.json.commits[0].parents, [historyFirst])
assert.deepEqual(r.json.commits[1].parents, [])
assert.deepEqual(r.json.commits[1].refs, [])
const mainRef = r.json.commits[0].refs.find((ref) => ref.name === 'main')
assert.ok(mainRef !== undefined, 'main should hold a badge on the HEAD commit')
assert.ok(mainRef.kind === 'head' || mainRef.kind === 'local')
assert.equal(r.json.hasMore, false)
assert.equal(r.json.truncated, false)
console.log('40 log OK', r.json.commits.map((commit) => commit.subject).join(' | '), JSON.stringify(r.json.commits[0].refs))

// 41. --all reaches a branch that is not checked out, and limit=1 reports a further page
GIT(history, 'checkout', '-q', '-b', 'feature')
writeFileSync(join(history, 'f.txt'), 'f\n')
GIT(history, 'add', 'f.txt')
GIT(history, ...IDENTITY, 'commit', '-q', '-m', 'feature work')
const historyFeature = GIT(history, 'rev-parse', 'HEAD').trim()
GIT(history, 'checkout', '-q', 'main')
r = await call(`/dsh-git-bar/log?dir=${dirParam(history)}`)
assert.equal(r.status, 200)
assert.deepEqual(
  r.json.commits.map((commit) => commit.subject).sort(),
  ['feature work', 'first', 'second'],
)
const featureRow = r.json.commits.find((commit) => commit.hash === historyFeature)
assert.deepEqual(featureRow.refs, [{ name: 'feature', kind: 'local' }])
assert.equal(r.json.hasMore, false)
r = await call(`/dsh-git-bar/log?dir=${dirParam(history)}&limit=1`)
assert.equal(r.status, 200)
assert.equal(r.json.commits.length, 1)
assert.equal(r.json.hasMore, true)
console.log('41 log --all + hasMore OK', featureRow.subject)

// 42. a bad or out-of-range limit is clamped, never refused
r = await call(`/dsh-git-bar/log?dir=${dirParam(history)}&limit=0`)
assert.equal(r.status, 200)
assert.equal(r.json.commits.length, 1)
assert.equal(r.json.hasMore, true)
r = await call(`/dsh-git-bar/log?dir=${dirParam(history)}&limit=-5`)
assert.equal(r.status, 200)
assert.equal(r.json.commits.length, 1)
r = await call(`/dsh-git-bar/log?dir=${dirParam(history)}&limit=99999`)
assert.equal(r.status, 200)
assert.equal(r.json.commits.length, 3)
assert.equal(r.json.hasMore, false)
r = await call(`/dsh-git-bar/log?dir=${dirParam(history)}&limit=abc&hash=zz&nonsense=1`)
assert.equal(r.status, 200)
assert.equal(r.json.commits.length, 3)
console.log('42 limit clamping OK')

// 43. log outside a repository degrades to an empty page
r = await call(`/dsh-git-bar/log?dir=${dirParam(plain)}`)
assert.equal(r.status, 200)
assert.deepEqual(r.json, {
  dir: plain,
  commits: [],
  hasMore: false,
  truncated: false,
  reason: 'not-a-repository',
  filters: { branch: null, author: null },
})
console.log('43 log not-a-repository OK')

// 44. commit lists the files it touched, with counts and the message body
const detail = makeRepo(join(base, 'detail'))
writeFileSync(join(detail, 'added.txt'), 'a1\na2\n')
GIT(detail, 'add', 'added.txt')
GIT(detail, 'rm', '-q', 'a.txt')
GIT(detail, ...IDENTITY, 'commit', '-q', '-m', 'touch files', '-m', 'body paragraph')
const touchSha = GIT(detail, 'rev-parse', 'HEAD').trim()
r = await call(`/dsh-git-bar/commit?dir=${dirParam(detail)}&hash=${touchSha}`)
assert.equal(r.status, 200)
assert.equal(r.json.dir, detail)
assert.equal(r.json.hash, touchSha)
assert.ok(touchSha.startsWith(r.json.short))
assert.equal(r.json.subject, 'touch files')
assert.equal(r.json.body, 'body paragraph')
assert.equal(r.json.author, 't')
assert.equal(r.json.email, 't@t')
assert.deepEqual(r.json.parents, [GIT(detail, 'rev-parse', 'HEAD~1').trim()])
assert.equal(r.json.truncated, false)
const fileByPath = new Map(r.json.files.map((file) => [file.path, file]))
assert.deepEqual([...fileByPath.keys()].sort(), ['a.txt', 'added.txt'])
assert.deepEqual(fileByPath.get('added.txt'), { path: 'added.txt', status: 'A', additions: 2, deletions: 0, binary: false })
assert.deepEqual(fileByPath.get('a.txt'), { path: 'a.txt', status: 'D', additions: 0, deletions: 1, binary: false })
console.log('44 commit files OK', JSON.stringify(r.json.files))

// 45. a rename is reported at its new path, a binary file carries no line counts
GIT(detail, 'mv', 'added.txt', 'moved.txt')
GIT(detail, ...IDENTITY, 'commit', '-q', '-m', 'rename added')
r = await call(`/dsh-git-bar/commit?dir=${dirParam(detail)}&hash=${GIT(detail, 'rev-parse', 'HEAD').trim()}`)
assert.equal(r.status, 200)
assert.deepEqual(r.json.files, [{ path: 'moved.txt', status: 'R', additions: 0, deletions: 0, binary: false }])
writeFileSync(join(detail, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255, 10, 0]))
GIT(detail, 'add', 'blob.bin')
GIT(detail, ...IDENTITY, 'commit', '-q', '-m', 'add blob')
r = await call(`/dsh-git-bar/commit?dir=${dirParam(detail)}&hash=${GIT(detail, 'rev-parse', 'HEAD').trim()}`)
assert.equal(r.status, 200)
assert.deepEqual(r.json.files, [{ path: 'blob.bin', status: 'A', additions: 0, deletions: 0, binary: true }])
console.log('45 rename and binary commit files OK')

// 46. commit parameter validation, unknown revision, and the non-repository degrade
r = await call(`/dsh-git-bar/commit?dir=${dirParam(detail)}&hash=zz`)
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'invalid-hash' })
r = await call(`/dsh-git-bar/commit?dir=${dirParam(detail)}`)
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'invalid-hash' })
r = await call(`/dsh-git-bar/commit?dir=${dirParam(detail)}&hash=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef`)
assert.equal(r.status, 404)
assert.equal(r.json.error, 'unknown-commit')
assert.match(r.json.message, /bad object/i)
assert.ok(r.json.message.length <= 400)
r = await call(`/dsh-git-bar/commit?dir=${dirParam(plain)}&hash=${touchSha}`)
assert.equal(r.status, 200)
assert.deepEqual(r.json, { dir: plain, reason: 'not-a-repository', files: [], truncated: false })
r = await call(`/dsh-git-bar/commit?hash=${touchSha}`)
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'no-directory' })
console.log('46 commit guards OK')

// 47. commit-diff shows one file's diff inside one commit, and refuses escapes
r = await call(`/dsh-git-bar/commit-diff?dir=${dirParam(detail)}&hash=${touchSha}&path=added.txt`)
assert.equal(r.status, 200)
assert.equal(r.json.dir, detail)
assert.equal(r.json.hash, touchSha)
assert.equal(r.json.path, 'added.txt')
assert.equal(r.json.truncated, false)
assert.match(r.json.diff, /^new file mode/m)
assert.match(r.json.diff, /^\+a1$/m)
assert.match(r.json.diff, /^\+a2$/m)
assert.equal(r.json.diff.includes('\u001b['), false)
r = await call(`/dsh-git-bar/commit-diff?dir=${dirParam(detail)}&hash=${touchSha}&path=a.txt`)
assert.equal(r.status, 200)
assert.match(r.json.diff, /^deleted file mode/m)
assert.match(r.json.diff, /^-one$/m)
// an abbreviated hash resolves to the full commit
r = await call(`/dsh-git-bar/commit-diff?dir=${dirParam(detail)}&hash=${touchSha.slice(0, 7)}&path=added.txt`)
assert.equal(r.status, 200)
assert.equal(r.json.hash, `${touchSha.slice(0, 7)}`)
assert.match(r.json.diff, /^\+a1$/m)
for (const bad of ['/etc/passwd', '../etc/passwd', 'a/../added.txt', '-added.txt', '']) {
  r = await call(`/dsh-git-bar/commit-diff?dir=${dirParam(detail)}&hash=${touchSha}&path=${dirParam(bad)}`)
  assert.equal(r.status, 400, `expected 400 for path ${JSON.stringify(bad)}`)
  assert.deepEqual(r.json, { error: 'invalid-path' })
}
r = await call(`/dsh-git-bar/commit-diff?dir=${dirParam(detail)}&path=added.txt`)
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'invalid-hash' })
r = await call(`/dsh-git-bar/commit-diff?dir=${dirParam(detail)}&hash=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef&path=added.txt`)
assert.equal(r.status, 404)
assert.equal(r.json.error, 'unknown-commit')
r = await call(`/dsh-git-bar/commit-diff?dir=${dirParam(detail)}&hash=${touchSha}&path=not-here.txt`)
assert.equal(r.status, 200)
assert.equal(r.json.diff, '')
assert.equal(r.json.truncated, false)
r = await call(`/dsh-git-bar/commit-diff?dir=${dirParam(plain)}&hash=${touchSha}&path=added.txt`)
assert.equal(r.status, 200)
assert.deepEqual(r.json, { dir: plain, reason: 'not-a-repository', diff: '', truncated: false })
console.log('47 commit-diff OK')

// 48. method guard and the auth gate reach the history routes too
for (const routePath of ['/dsh-git-bar/log', '/dsh-git-bar/commit', '/dsh-git-bar/commit-diff']) {
  r = await call(`${routePath}?dir=${dirParam(history)}&hash=${touchSha}&path=added.txt`, { method: 'POST' })
  assert.equal(r.status, 405, `expected 405 for ${routePath}`)
  assert.equal(r.headers.allow, 'GET')
}
connected = false
r = await call(`/dsh-git-bar/log?dir=${dirParam(history)}`)
assert.equal(r.status, 503)
assert.deepEqual(r.json, { error: 'no-connection' })
connected = true
console.log('48 history route guards OK')

// 49. a branch filter walks that ref instead of every ref, and is echoed back
// The two branches diverge after `first`, so each one can only reach its own tip.
const filtered = makeRepo(join(base, 'filtered'))
GIT(filtered, 'checkout', '-q', '-b', 'side')
writeFileSync(join(filtered, 's.txt'), 's\n')
GIT(filtered, 'add', 's.txt')
GIT(
  filtered,
  '-c',
  'user.name=alice',
  '-c',
  'user.email=alice@example.com',
  'commit',
  '-q',
  '-m',
  'side work by alice',
)
GIT(filtered, 'checkout', '-q', 'main')
writeFileSync(join(filtered, 'a.txt'), 'one\ntwo\n')
GIT(filtered, ...IDENTITY, 'commit', '-q', '-am', 'second by t')
r = await call(`/dsh-git-bar/log?dir=${dirParam(filtered)}&branch=side`)
assert.equal(r.status, 200)
assert.deepEqual(r.json.filters, { branch: 'side', author: null })
// `side` branched off `first`, so it holds its own commit plus that ancestor —
// and not the `second by t` commit that only `main` can reach
assert.deepEqual(
  r.json.commits.map((commit) => commit.subject),
  ['side work by alice', 'first'],
)
assert.equal(r.json.hasMore, false)
assert.equal(r.json.truncated, false)
r = await call(`/dsh-git-bar/log?dir=${dirParam(filtered)}&branch=main`)
assert.equal(r.status, 200)
assert.deepEqual(r.json.filters, { branch: 'main', author: null })
assert.deepEqual(
  r.json.commits.map((commit) => commit.subject),
  ['second by t', 'first'],
)
assert.equal(r.json.commits.some((commit) => commit.subject === 'side work by alice'), false)
console.log('49 log branch filter OK', r.json.commits.map((commit) => commit.subject).join(' | '))

// 50. a branch that is not a plain refname is refused, one git cannot resolve is a 400
for (const bad of ['-x', 'a..b', 'ma in', 'HEAD~1', 'a^*', 'x'.repeat(201)]) {
  r = await call(`/dsh-git-bar/log?dir=${dirParam(filtered)}&branch=${dirParam(bad)}`)
  assert.equal(r.status, 400, `expected 400 for branch ${JSON.stringify(bad)}`)
  assert.deepEqual(r.json, { error: 'invalid-branch' })
}
r = await call(`/dsh-git-bar/log?dir=${dirParam(filtered)}&branch=no-such-branch`)
assert.equal(r.status, 400)
assert.equal(r.json.reason, 'unknown-ref')
assert.equal(r.json.dir, filtered)
assert.deepEqual(r.json.commits, [])
assert.equal(r.json.hasMore, false)
assert.equal(r.json.truncated, false)
assert.equal(r.json.filters.branch, 'no-such-branch')
assert.match(r.json.message, /unknown revision|ambiguous argument/i)
console.log('50 log branch guards OK', JSON.stringify(r.json.message))

// 51. an author filter narrows the graph without picking a branch
r = await call(`/dsh-git-bar/log?dir=${dirParam(filtered)}&author=alice`)
assert.equal(r.status, 200)
assert.deepEqual(r.json.filters, { branch: null, author: 'alice' })
assert.deepEqual(
  r.json.commits.map((commit) => commit.subject),
  ['side work by alice'],
)
// --all still applies, so both of `t`'s commits on both branches are in reach
r = await call(`/dsh-git-bar/log?dir=${dirParam(filtered)}&author=t`)
assert.equal(r.status, 200)
assert.deepEqual(r.json.filters, { branch: null, author: 't' })
assert.deepEqual(
  r.json.commits.map((commit) => commit.subject).sort(),
  ['first', 'second by t'],
)
// --author matches the whole `Name <email>` ident, so an address works too
r = await call(`/dsh-git-bar/log?dir=${dirParam(filtered)}&author=alice%40example.com`)
assert.equal(r.status, 200)
assert.equal(r.json.commits.length, 1)
console.log('51 log author filter OK', r.json.filters.author)

// 52. an author that is not a bounded control-free value is refused
for (const bad of ['x'.repeat(201), 'ali\nce', 'ali\u0007ce', 'tab\there']) {
  r = await call(`/dsh-git-bar/log?dir=${dirParam(filtered)}&author=${dirParam(bad)}`)
  assert.equal(r.status, 400, `expected 400 for author ${JSON.stringify(bad)}`)
  assert.deepEqual(r.json, { error: 'invalid-author' })
}
console.log('52 log author guards OK')

// 53. with no filter in use both keys are null, and a filtered call still degrades
r = await call(`/dsh-git-bar/log?dir=${dirParam(filtered)}`)
assert.deepEqual(r.json.filters, { branch: null, author: null })
assert.equal(r.json.commits.length, 3)
r = await call(`/dsh-git-bar/log?dir=${dirParam(filtered)}&branch=&author=`)
assert.equal(r.status, 200)
assert.deepEqual(r.json.filters, { branch: null, author: null })
assert.equal(r.json.commits.length, 3)
r = await call(`/dsh-git-bar/log?dir=${dirParam(filtered)}&branch=side&author=alice`)
assert.equal(r.status, 200)
assert.deepEqual(r.json.filters, { branch: 'side', author: 'alice' })
assert.deepEqual(
  r.json.commits.map((commit) => commit.subject),
  ['side work by alice'],
)
r = await call(`/dsh-git-bar/log?dir=${dirParam(plain)}&branch=main&author=t`)
assert.equal(r.status, 200)
assert.deepEqual(r.json, {
  dir: plain,
  commits: [],
  hasMore: false,
  truncated: false,
  reason: 'not-a-repository',
  filters: { branch: 'main', author: 't' },
})
console.log('53 log filters echo OK')

// 54. authors aggregates the whole history per name+email, most prolific first
const people = makeRepo(join(base, 'people'), { commit: false })
writeFileSync(join(people, 'p.txt'), 'p\n')
GIT(people, 'add', 'p.txt')
const commitAs = (who, email, message) =>
  GIT(people, '-c', `user.name=${who}`, '-c', `user.email=${email}`, 'commit', '--allow-empty', '-q', '-m', message)
commitAs('alice', 'alice@example.com', 'a1')
commitAs('alice', 'alice@example.com', 'a2')
commitAs('bob', 'bob@example.com', 'b1')
commitAs('Carol', 'carol@example.com', 'c1')
commitAs('Carol', 'carol@example.com', 'c2')
commitAs('alice', 'alice@example.com', 'a3')
// the same name under another address is a separate candidate: the filter matches the ident
commitAs('alice', 'alice@work.example', 'a4')
// and a branch that is not checked out still contributes: candidates cover every ref
GIT(people, 'checkout', '-q', '-b', 'side')
commitAs('dave', 'dave@example.com', 'd1')
GIT(people, 'checkout', '-q', 'main')
const expectedAuthors = [
  { name: 'alice', email: 'alice@example.com', count: 3 },
  { name: 'Carol', email: 'carol@example.com', count: 2 },
  { name: 'alice', email: 'alice@work.example', count: 1 },
  { name: 'bob', email: 'bob@example.com', count: 1 },
  { name: 'dave', email: 'dave@example.com', count: 1 },
].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name) || left.email.localeCompare(right.email))
r = await call(`/dsh-git-bar/authors?dir=${dirParam(people)}`)
assert.equal(r.status, 200)
assert.equal(r.json.dir, people)
assert.equal(r.json.truncated, false)
assert.deepEqual(r.json.authors, expectedAuthors)
assert.deepEqual(
  r.json.authors.map((author) => author.count),
  [3, 2, 1, 1, 1],
)
assert.ok(
  r.json.authors.some((author) => author.name === 'dave'),
  'an author who only commits on an unchecked-out branch is still a candidate',
)
console.log('54 authors aggregation OK', JSON.stringify(r.json.authors))

// 55. more than 500 candidates are cut to 500 and flagged, keeping the sorted head
// One `git fast-import` stream: 501 single-commit authors would otherwise cost
// seconds of process spawns inside a unit test.
const crowd = makeRepo(join(base, 'crowd'), { commit: false })
const imported = []
for (let index = 0; index < 501; index += 1) {
  const ident = `Person${index} <person${index}@example.com> 1700000000 +0000`
  const message = `c${index}`
  imported.push(
    'commit refs/heads/main',
    `mark :${index + 1}`,
    `author ${ident}`,
    `committer ${ident}`,
    `data ${Buffer.byteLength(message)}`,
    message,
  )
  if (index > 0) imported.push(`from :${index}`)
  imported.push('')
}
execFileSync('git', ['-C', crowd, 'fast-import', '--quiet'], {
  input: `${imported.join('\n')}\n`,
  stdio: ['pipe', 'pipe', 'pipe'],
})
r = await call(`/dsh-git-bar/authors?dir=${dirParam(crowd)}`)
assert.equal(r.status, 200)
assert.equal(r.json.authors.length, 500)
assert.equal(r.json.truncated, true)
assert.equal(r.json.authors.every((author) => author.count === 1), true)
const expectedCapped = Array.from({ length: 501 }, (_, index) => `Person${index}`).sort((left, right) => left.localeCompare(right))
assert.deepEqual(r.json.authors.map((author) => author.name), expectedCapped.slice(0, 500))
console.log('55 authors cap OK', r.json.authors.length, r.json.truncated)

// 56. authors outside a repository is an empty list, not an error
r = await call(`/dsh-git-bar/authors?dir=${dirParam(plain)}`)
assert.equal(r.status, 200)
assert.deepEqual(r.json, { dir: plain, authors: [], truncated: false })
console.log('56 authors not-a-repository OK')

// 57. authors sits behind the same auth gate and method guard as every read route
rejection = 401
r = await call(`/dsh-git-bar/authors?dir=${dirParam(people)}`)
assert.equal(r.status, 401)
assert.equal(r.body, '')
rejection = undefined
r = await call(`/dsh-git-bar/authors?dir=${dirParam(people)}`, { method: 'POST' })
assert.equal(r.status, 405)
assert.equal(r.headers.allow, 'GET')
console.log('57 authors guards OK')

// 58. authors resolves its directory the same way: Session store first, absolute hint only
sessions = { 'session-people': { header: { cwd: people } } }
r = await call('/dsh-git-bar/authors?sessionId=session-people&dir=/definitely/not/this')
assert.equal(r.status, 200)
assert.equal(r.json.dir, people)
assert.equal(r.json.authors.length, 5)
sessions = {}
r = await call('/dsh-git-bar/authors?dir=relative/path')
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'no-directory' })
r = await call('/dsh-git-bar/authors')
assert.equal(r.status, 400)
assert.deepEqual(r.json, { error: 'no-directory' })
console.log('58 authors directory OK')

// 59. a history too long for the git buffer is reported as truncated, not as a failure
// One author over ~6000 commits: the aggregated list is one row, so `truncated`
// here can only come from the stdout buffer, not from the 500-row cap.
const deep = makeRepo(join(base, 'deep'), { commit: false })
const streamed = []
for (let index = 0; index < 6000; index += 1) {
  const ident = 'Some One <someone.with.a.long.address@example.com> 1700000000 +0000'
  const message = `d${index}`
  streamed.push(
    'commit refs/heads/main',
    `mark :${index + 1}`,
    `author ${ident}`,
    `committer ${ident}`,
    `data ${Buffer.byteLength(message)}`,
    message,
  )
  if (index > 0) streamed.push(`from :${index}`)
  streamed.push('')
}
execFileSync('git', ['-C', deep, 'fast-import', '--quiet'], {
  input: `${streamed.join('\n')}\n`,
  stdio: ['pipe', 'pipe', 'pipe'],
})
r = await call(`/dsh-git-bar/authors?dir=${dirParam(deep)}`)
assert.equal(r.status, 200)
assert.equal(r.json.authors.length, 1)
assert.equal(r.json.authors[0].name, 'Some One')
assert.equal(r.json.truncated, true)
assert.ok(r.json.authors[0].count > 5000, `expected a large partial count, got ${r.json.authors[0].count}`)
console.log('59 authors buffer truncation OK', r.json.authors[0].count, r.json.truncated)

rmSync(base, { recursive: true, force: true })
console.log('\nALL HOST TESTS PASSED')
