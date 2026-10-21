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
assert.equal(routes.length, 6)
assert.ok(routes.every((route) => route.kind === 'exact'))
assert.deepEqual(routes.map((route) => route.path), [
  '/dsh-git-bar/info',
  '/dsh-git-bar/branches',
  '/dsh-git-bar/changes',
  '/dsh-git-bar/diff',
  '/dsh-git-bar/branches/checkout',
  '/dsh-git-bar/branches/create',
])
assert.deepEqual(effects, [
  'git-bar: GET /dsh-git-bar/info',
  'git-bar: GET /dsh-git-bar/branches',
  'git-bar: GET /dsh-git-bar/changes',
  'git-bar: GET /dsh-git-bar/diff',
  'git-bar: POST /dsh-git-bar/branches/checkout',
  'git-bar: POST /dsh-git-bar/branches/create',
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

rmSync(base, { recursive: true, force: true })
console.log('\nALL HOST TESTS PASSED')
