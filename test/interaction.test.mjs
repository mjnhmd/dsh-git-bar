/**
 * 交互测试：用一个能跑 hooks 的迷你 React 挂载状态条，验证
 * 工作树弹层、被占用分支标灰这两条真实交互路径。
 *
 * 单元测试里的假 React 是 pure 的（hook 返回值固定），测不了“点一下会怎样”，
 * 所以这里补一层最小可用的运行时：函数组件 + useState/useEffect/useRef，
 * 事件处理器直接调用节点上的 props。
 */

import assert from 'node:assert/strict'

function createRuntime() {
  let state = new Map()
  let effects = []
  let hookCursor = 0
  let instancePath = []
  let current

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      const key = `${instancePath.join('/')}#${hookCursor++}`
      if (!state.has(key)) state.set(key, typeof initial === 'function' ? initial() : initial)
      const set = (next) => {
        const value = typeof next === 'function' ? next(state.get(key)) : next
        state.set(key, value)
        schedule()
      }
      return [state.get(key), set]
    },
    // 依赖比对的 useEffect：deps 变了就重跑，没给 deps 就只跑一次。
    // 组件点选后要重新发请求（历史标签页的详情/diff），所以不能只在首屏跑。
    useEffect(fn, deps) {
      if (shouldRunEffect(fn, deps)) effects.push(fn)
    },
    useLayoutEffect(fn, deps) {
      if (shouldRunEffect(fn, deps)) effects.push(fn)
    },
    useRef(initial) {
      const key = `${instancePath.join('/')}ref${hookCursor++}`
      if (!state.has(key)) state.set(key, { current: initial })
      return state.get(key)
    },
    useMemo(factory) {
      return factory()
    },
  }

  /** 副作用该不该跑：记住每个 hook 位置上次的 deps。 */
  function shouldRunEffect(fn, deps) {
    const key = `${instancePath.join('/')}effect#${hookCursor++}`
    const seen = state.has(key)
    const previous = state.get(key)
    if (!seen) {
      state.set(key, deps === undefined ? undefined : Array.from(deps))
      return true
    }
    if (deps === undefined) return false
    if (previous === undefined || previous.length !== deps.length) {
      state.set(key, Array.from(deps))
      return true
    }
    const changed = deps.some((value, index) => !Object.is(value, previous[index]))
    if (changed) state.set(key, Array.from(deps))
    return changed
  }

  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      render()
    })
  }

  function walk(node, path) {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map((child, index) => walk(child, `${path}[${index}]`))
    if (typeof node.type === 'function') {
      const savedPath = instancePath
      const savedCursor = hookCursor
      instancePath = [...savedPath, `${node.type.name || 'anon'}@${path}`]
      hookCursor = 0
      const rendered = node.type({ ...node.props, children: node.children })
      instancePath = savedPath
      hookCursor = savedCursor
      return walk(rendered, path)
    }
    return { ...node, children: (node.children ?? []).map((child, index) => walk(child, `${path}.${index}`)) }
  }

  // 每轮渲染后把排队的副作用跑掉，再渲染一轮看到它们的结果；有上限，防止互相触发打转。
  function render(runs = 0) {
    const tree = walk(current.element, 'root')
    if (effects.length > 0 && runs < 8) {
      const pending = effects
      effects = []
      for (const effect of pending) effect()
      return render(runs + 1)
    }
    return tree
  }

  return {
    mount(element) {
      current = { element }
      effects = []
      state = new Map()
      return render()
    },
    rerender(element) {
      current = { element }
      return render()
    },
    React,
  }
}

function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (typeof node.type !== 'function' && predicate(node)) out.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, out)
  return out
}

function textOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) textOf(child, out); return out }
  if (typeof node === 'object') { for (const child of node.children ?? []) textOf(child, out) }
  return out
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const worktreeReply = {
  dir: '/repo-link',
  root: '/repo-link',
  worktrees: [
    { path: '/repo', name: 'repo', branch: 'main', detached: false, sha: 'aaa', bare: false, locked: false, prunable: false, main: true, current: false, dirty: { changed: 0 } },
    { path: '/repo-link', name: 'repo-link', branch: 'codex/perf', detached: false, sha: 'bbb', bare: false, locked: false, prunable: false, main: false, current: true, dirty: { changed: 2 } },
    { path: '/repo-hotfix', name: 'repo-hotfix', branch: null, detached: true, sha: 'ccc', bare: false, locked: false, prunable: false, main: false, current: false, dirty: null },
    { path: '/repo-gone', name: 'repo-gone', branch: 'old', detached: false, sha: 'ddd', bare: false, locked: false, prunable: false, main: false, current: false, dirty: { changed: 1 } },
  ],
}

const branchReply = {
  dir: '/repo-link',
  repository: { root: '/repo-link', name: 'repo-link', branch: 'codex/perf', detached: false, sha: 'bbb', dirty: { changed: 0 }, upstream: null, ahead: 0, behind: 0, commitUrl: 'https://github.com/o/r/commit/bbb', worktree: { linked: true, mainRoot: '/repo', count: 2 } },
  branches: [
    { name: 'codex/perf', current: true, upstream: null, ahead: 0, behind: 0, subject: 'wip', checkedOutIn: '/repo-link' },
    { name: 'main', current: false, upstream: null, ahead: 0, behind: 0, subject: 'first', checkedOutIn: '/repo' },
    { name: 'ghost', current: false, upstream: null, ahead: 0, behind: 0, subject: 'free', checkedOutIn: null },
  ],
  dirty: { changed: 0, staged: 0, unstaged: 0, untracked: 0 },
}

const infoReply = {
  dir: '/repo-link',
  repository: branchReply.repository,
}

const fetches = []
const requests = []
const logReply = {
  dir: '/repo-link',
  hasMore: false,
  commits: [
    { hash: 'm0000001', short: 'm0000001', subject: 'Merge branch feature', author: 'Ada', when: '2026-10-27T02:00:00Z', parents: ['a0000001', 'b0000001'], refs: [{ name: 'HEAD -> main', kind: 'head' }, { name: 'v1.0', kind: 'tag' }] },
    { hash: 'a0000001', short: 'a0000001', subject: 'Add page', author: 'Ada', when: '2026-10-26T02:00:00Z', parents: ['c0000001'], refs: [] },
    { hash: 'b0000001', short: 'b0000001', subject: 'Bump dep', author: 'Bob', when: '2026-10-25T02:00:00Z', parents: ['c0000001'], refs: [{ name: 'origin/feature', kind: 'remote' }] },
    { hash: 'c0000001', short: 'c0000001', subject: 'Initial commit', author: 'Ada', when: '2026-10-24T02:00:00Z', parents: [], refs: [] },
  ],
}
// 服务端筛选：branch / author 各有一张允许清单，limit 决定 hasMore。
const branchAllowed = { main: ['m0000001', 'a0000001', 'c0000001'], 'codex/perf': ['b0000001', 'c0000001'] }
const authorAllowed = { Ada: ['m0000001', 'a0000001', 'c0000001'], Bob: ['b0000001'] }
const logReplyFor = (url) => {
  const query = new URLSearchParams(url.slice(url.indexOf('?') + 1))
  const branch = query.get('branch') ?? ''
  const author = query.get('author') ?? ''
  const limit = Number(query.get('limit') ?? '60')
  let allowed = null
  if (branch !== '') allowed = new Set(branchAllowed[branch] ?? [])
  if (author !== '') {
    const names = authorAllowed[author] ?? []
    allowed = allowed === null ? new Set(names) : new Set(names.filter((hash) => allowed.has(hash)))
  }
  return {
    ...logReply,
    commits: allowed === null ? logReply.commits : logReply.commits.filter((commit) => allowed.has(commit.hash)),
    hasMore: limit < 120,
    filters: { branch: branch === '' ? null : branch, author: author === '' ? null : author },
  }
}
const commitReply = {
  hash: 'm0000001',
  short: 'm0000001',
  subject: 'Merge branch feature',
  body: 'why this exists',
  author: 'Ada',
  when: '2026-10-27T02:00:00Z',
  truncated: false,
  files: [
    { path: 'src/a.js', status: 'M', additions: 3, deletions: 1, binary: false },
    { path: 'assets/b.bin', status: 'A', additions: 0, deletions: 0, binary: true },
  ],
}
const commitDiffReply = { path: 'src/a.js', truncated: false, diff: '@@ -1 +1 @@\n-old line\n+new line\n' }
// 提交人候选由 /authors 提供：Zoe 只存在于尚未加载的历史里，用来证明候选不依赖当前页。
let authorsMode = 'ok'
const authorsReply = {
  dir: '/repo-link',
  truncated: false,
  authors: [
    { name: 'Zoe', email: 'zoe@example.com', count: 9 },
    { name: 'Ada', email: 'ada@example.com', count: 3 },
    { name: 'Bob', email: 'bob@example.com', count: 1 },
  ],
}
// 一个比一页更长的历史：翻页用例用，假 Host 按 skip/limit 切片，行为对齐真 Host 的偏移量分页。
const pagingCommits = Array.from({ length: 130 }, (_, index) => {
  const hash = `h${String(index).padStart(7, '0')}`
  return {
    hash,
    short: hash,
    subject: `p${String(index).padStart(3, '0')}`,
    parents: index === 0 ? [] : [`h${String(index - 1).padStart(7, '0')}`],
    author: 'Ada',
    email: 'ada@example.com',
    when: '2026-10-27T02:00:00Z',
    refs: [],
  }
})
let logMode = 'default'
const pagingReplyFor = (url) => {
  const query = new URLSearchParams(url.slice(url.indexOf('?') + 1))
  const limit = Number(query.get('limit') ?? '60')
  const skip = Number(query.get('skip') ?? '0')
  return {
    dir: '/repo-link',
    commits: pagingCommits.slice(skip, skip + limit),
    hasMore: skip + limit < pagingCommits.length,
    truncated: false,
    reason: '',
    filters: { branch: null, author: null },
  }
}
globalThis.fetch = async (url) => {
  const text = String(url)
  fetches.push(text)
  if (text.startsWith('/dsh-git-bar/worktrees')) return { ok: true, json: async () => worktreeReply }
  if (text.startsWith('/dsh-git-bar/branches')) return { ok: true, json: async () => branchReply }
  if (text.startsWith('/dsh-git-bar/authors')) {
    return authorsMode === 'ok'
      ? { ok: true, json: async () => authorsReply }
      : { ok: false, status: 404, json: async () => ({}) }
  }
  if (text.startsWith('/dsh-git-bar/commit-diff')) return { ok: true, json: async () => commitDiffReply }
  if (text.startsWith('/dsh-git-bar/commit')) return { ok: true, json: async () => commitReply }
  if (text.startsWith('/dsh-git-bar/log')) return { ok: true, json: async () => (logMode === 'paging' ? pagingReplyFor(text) : logReplyFor(text)) }
  if (text.startsWith('/dsh-git-bar/info')) return { ok: true, json: async () => infoReply }
  return { ok: false, status: 404, json: async () => ({}) }
}
globalThis.Request = class {}
const opened = []
globalThis.window = {
  __ModuleLoader__: { load(definition) { globalThis.__captured = definition } },
  location: { protocol: 'http:', origin: 'http://127.0.0.1:65337' },
  innerWidth: 1440,
  innerHeight: 900,
  setInterval: () => 1,
  clearInterval: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  getComputedStyle: () => ({ display: 'block' }),
  getSelection: () => ({ toString: () => '' }),
  open: (url) => opened.push(url),
}
const listeners = []
globalThis.document = {
  visibilityState: 'visible',
  documentElement: { lang: 'zh-CN' },
  addEventListener: (type, fn) => listeners.push([type, fn]),
  removeEventListener: () => {},
  createElement: () => ({ style: {}, select() {}, focus() {} }),
  body: { appendChild() {}, removeChild() {} },
}
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { clipboard: { writeText: async (value) => opened.push(`copy:${value}`) } },
})

await import('../client.js')

const runtime = createRuntime()
const plugin = globalThis.__captured.factory(() => runtime.React)

// 工作区注册表：/repo 与 /repo-link 已注册，/repo-hotfix 未注册，/repo-gone 的目录已被删掉。
// create 与 host 侧行为一致：同一目录幂等返回已有记录；目录不存在时抛 workspace/invalid-path。
const workspaceItems = [{ workspaceId: 'ws-1', path: '/repo' }, { workspaceId: 'ws-2', path: '/repo-link' }]
const services = {
  workspaces: {
    list: { getSnapshot: () => ({ items: workspaceItems }) },
    create: async ({ path }) => {
      requests.push(`create:${path}`)
      if (path === '/repo-gone') {
        const error = new Error(`cannot create a Workspace at "${path}": path is not a directory`)
        error.rpcError = { code: 'workspace/invalid-path' }
        throw error
      }
      const known = workspaceItems.find((item) => item.path === path)
      if (known !== undefined) return known
      const created = { workspaceId: `ws-${workspaceItems.length + 1}`, path }
      workspaceItems.push(created)
      return created
    },
  },
  uiWorkspace: { openWorkspace: async (id) => { requests.push(`open:${id}`) } },
  locale: { register: () => () => {}, bind: () => (key, params) => (params === undefined ? key : `${key}(${JSON.stringify(params)})`) },
  sessions: { list: { getSnapshot: () => ({ byId: { s1: { cwd: '/repo-link' } } }) } },
}

// 插件注册两个座位：状态条（conversation.input.dock）和历史标签页（conversation.view）。
const seats = new Map()
const ctx = {
  get: (name) => services[name],
  effect: (fn) => fn(),
  slots: {
    inject: (_name, callback) => callback(),
    register: (options, component) => {
      seats.set(options.name, { options, component })
      return () => {}
    },
  },
}
plugin.apply(ctx)
assert.ok(seats.has('conversation.input.dock'), 'dock component registered')
assert.ok(seats.has('conversation.view'), 'history view registered')
const slotOptions = seats.get('conversation.input.dock').options
const slotComponent = seats.get('conversation.input.dock').component

const props = slotOptions.inject('s1')
const element = runtime.React.createElement(slotComponent, props)
let tree = runtime.mount(element)
await flush()
tree = runtime.rerender(element)

// 1. 工作树标签：可点，点了会去读工作树列表
const trigger = findAll(tree, (node) => node.props['data-git-bar-worktrees-trigger'] !== undefined)[0]
assert.ok(trigger !== undefined, 'worktree trigger rendered')
assert.equal(trigger.type, 'button')
assert.ok(
  findAll(tree, (node) => node.props['data-git-bar-commit'] !== undefined).length === 1,
  'hash is a commit trigger',
)
trigger.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ top: 600, right: 700 }) } })
await flush()
tree = runtime.rerender(element)
assert.ok(fetches.some((url) => url.startsWith('/dsh-git-bar/worktrees')), 'worktree list fetched')
const rows = findAll(tree, (node) => typeof node.props['data-worktree'] === 'string')
assert.deepEqual(rows.map((row) => row.props['data-worktree']), ['/repo', '/repo-link', '/repo-hotfix', '/repo-gone'])
console.log('1 worktree popover OK:', rows.length, 'rows')

// 2. 当前工作树没有“在此新建会话”，其余三个有
const openers = findAll(tree, (node) => typeof node.props['data-worktree-open'] === 'string')
assert.deepEqual(openers.map((node) => node.props['data-worktree-open']), ['/repo', '/repo-hotfix', '/repo-gone'])
console.log('2 open actions OK:', openers.length)

// 3. 已注册目录：create 幂等返回同一个工作区，再在那里开新会话
openers[0].props.onClick()
await flush()
assert.deepEqual(requests, ['create:/repo', 'open:ws-1'])

// 3b. 未注册的工作树目录：当场注册成工作区再开（此前这里直接报“该目录还不是工作区”）
await openers[1].props.onClick()
await flush()
assert.deepEqual(requests, ['create:/repo', 'open:ws-1', 'create:/repo-hotfix', 'open:ws-3'])

// 3c. 目录已被删除：create 抛 workspace/invalid-path，弹层留在原地并给提示。
// 3b 成功会关掉弹层，所以这里重新打开。
trigger.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ top: 600, right: 700 }) } })
await flush()
tree = runtime.rerender(element)
const goneOpener = findAll(tree, (node) => node.props['data-worktree-open'] === '/repo-gone')[0]
assert.ok(goneOpener !== undefined, 'vanished worktree still offers the action')
await goneOpener.props.onClick()
await flush()
tree = runtime.rerender(element)
assert.ok(textOf(tree).some((text) => text.includes('worktree.invalidPath')), 'invalid path reported')
assert.equal(findAll(tree, (node) => node.props['data-worktree-open'] === '/repo-gone').length, 1, 'popover stays open')
console.log('3 worktree session OK:', requests.length, 'host calls')

// 4. 复制路径
const copier = findAll(tree, (node) => node.props['data-worktree-copy'] === '/repo-hotfix')[0]
await copier.props.onClick()
assert.ok(opened.includes('copy:/repo-hotfix'), 'path copied')

// 5. 分支菜单：被别的工作树占用的分支标灰，空闲的仍可点
const branchTrigger = findAll(tree, (node) => node.props['data-git-bar-trigger'] !== undefined)[0]
branchTrigger.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ top: 600, right: 700 }) } })
await flush()
tree = runtime.rerender(element)
const branchRows = findAll(tree, (node) => typeof node.props['data-branch'] === 'string')
const byName = new Map(branchRows.map((row) => [row.props['data-branch'], row]))
assert.equal(byName.get('main').props['data-branch-occupied'], 'repo')
assert.equal(byName.get('main').props.disabled, true)
assert.equal(byName.get('main').props['aria-disabled'], undefined)
assert.notEqual(byName.get('ghost').props.disabled, true)
assert.notEqual(byName.get('codex/perf').props.disabled, true)
console.log('5 occupied branches greyed OK')

// --- Git 历史标签页：图谱 → 提交详情 → 单文件 diff ---
const historySeat = seats.get('conversation.view')
const historyProps = historySeat.options.inject('s1')
const historyElement = runtime.React.createElement(historySeat.component, historyProps)
let historyTree = runtime.mount(historyElement)
await flush()
historyTree = runtime.rerender(historyElement)

// 6. 提交列表按 host 返回的顺序渲染，每行都带分叉图
const commitRows = findAll(historyTree, (node) => typeof node.props['data-history-commit'] === 'string')
assert.deepEqual(commitRows.map((row) => row.props['data-history-commit']), ['m0000001', 'a0000001', 'b0000001', 'c0000001'])
const graphs = findAll(historyTree, (node) => node.type === 'svg')
assert.equal(graphs.length, commitRows.length, 'every row draws its graph cell')
const mergeEdgeCount = findAll(graphs[0], (node) => node.type === 'path').length
assert.equal(mergeEdgeCount, 2, 'merge commit forks into two lanes')
assert.ok(fetches.some((url) => url.includes('/dsh-git-bar/log') && url.includes('sessionId=s1')), 'log fetched for the session')
console.log('6 history list + graph OK:', commitRows.length, 'rows,', mergeEdgeCount, 'edges on the merge')

// 7. 点提交 → 读详情；详情里列出该提交的文件（二进制不给行数）
commitRows[0].props.onClick()
await flush()
historyTree = runtime.rerender(historyElement)
assert.ok(fetches.some((url) => url.includes('/dsh-git-bar/commit?') && url.includes('hash=m0000001')), 'commit detail fetched')
const subjectNode = findAll(historyTree, (node) => node.props['data-history-subject'] !== undefined)[0]
assert.ok(subjectNode !== undefined, 'detail subject rendered')
assert.equal(subjectNode.children.join(''), 'Merge branch feature')
const fileRows = findAll(historyTree, (node) => typeof node.props['data-history-file'] === 'string')
assert.deepEqual(fileRows.map((row) => row.props['data-history-file']), ['src/a.js', 'assets/b.bin'])
assert.ok(textOf(fileRows[0]).join(' ').includes('+3 −1'), 'line counts shown')
assert.ok(textOf(fileRows[1]).join(' ').includes('history.binary'), 'binary file marked')
console.log('7 commit detail OK:', fileRows.map((row) => row.props['data-history-file']).join(', '))

// 8. 点文件 → 读这笔提交里该文件的 diff，并按行上色
fileRows[0].props.onClick()
await flush()
historyTree = runtime.rerender(historyElement)
assert.ok(fetches.some((url) => url.includes('/dsh-git-bar/commit-diff?') && url.includes('hash=m0000001') && url.includes('path=src%2Fa.js')), 'file diff fetched')
const diffLines = findAll(historyTree, (node) => node.props['data-history-diff'] !== undefined)[0]
assert.ok(diffLines !== undefined, 'diff rendered')
const lines = findAll(diffLines, (node) => node.type === 'div').map((node) => textOf(node).join(''))
assert.ok(lines.includes('+new line'), JSON.stringify(lines))
assert.ok(lines.includes('-old line'), JSON.stringify(lines))
console.log('8 file diff OK:', lines.length, 'lines')

// 9. 过滤框只按关键字筛行，不动已选中的提交
const filterInput = findAll(historyTree, (node) => node.props['data-history-filter'] !== undefined)[0]
filterInput.props.onChange({ target: { value: 'Initial' } })
historyTree = runtime.rerender(historyElement)
const filtered = findAll(historyTree, (node) => typeof node.props['data-history-commit'] === 'string')
assert.deepEqual(filtered.map((row) => row.props['data-history-commit']), ['c0000001'])
console.log('9 filter OK:', filtered.length, 'row')

// 10. 分支下拉：选项来自 /branches，选中后带 branch 参数重拉列表
const clearInput = findAll(historyTree, (node) => node.props['data-history-filter'] !== undefined)[0]
clearInput.props.onChange({ target: { value: '' } })
historyTree = runtime.rerender(historyElement)
const branchChip = findAll(historyTree, (node) => node.props['data-history-chip'] === 'branch')[0]
branchChip.props.onClick()
await flush()
historyTree = runtime.rerender(historyElement)
assert.ok(fetches.some((url) => url.startsWith('/dsh-git-bar/branches')), 'branch list fetched for the dropdown')
const branchOptions = findAll(historyTree, (node) => typeof node.props['data-history-option'] === 'string')
assert.deepEqual(
  branchOptions.map((option) => option.props['data-history-option']),
  ['', 'codex/perf', 'main', 'ghost'],
  'all-branches entry plus every local branch',
)
branchOptions.find((option) => option.props['data-history-option'] === 'main').props.onClick()
await flush()
historyTree = runtime.rerender(historyElement)
assert.ok(
  fetches.some((url) => url.includes('/dsh-git-bar/log') && url.includes('branch=main')),
  'log refetched with branch=main',
)
const mainRows = findAll(historyTree, (node) => typeof node.props['data-history-commit'] === 'string')
assert.deepEqual(mainRows.map((row) => row.props['data-history-commit']), ['m0000001', 'a0000001', 'c0000001'])
console.log('10 branch dropdown OK:', mainRows.length, 'rows on main')

// 11. 重置：清掉筛选并重新拉全量，重置按钮随之消失
const resetButton = findAll(historyTree, (node) => node.props['data-history-reset'] !== undefined)[0]
assert.ok(resetButton !== undefined, 'reset appears once a filter is active')
resetButton.props.onClick()
await flush()
historyTree = runtime.rerender(historyElement)
const lastLog = fetches.filter((url) => url.includes('/dsh-git-bar/log')).at(-1)
assert.ok(!lastLog.includes('branch='), `reset drops branch: ${lastLog}`)
assert.ok(!lastLog.includes('author='), `reset drops author: ${lastLog}`)
assert.equal(findAll(historyTree, (node) => node.props['data-history-reset'] !== undefined).length, 0)
console.log('11 reset OK')

// 12. 提交人下拉：候选来自 /authors（整条历史，含这一页没加载的 Zoe），按提交数降序
const authorChip = findAll(historyTree, (node) => node.props['data-history-chip'] === 'author')[0]
authorChip.props.onClick()
await flush()
historyTree = runtime.rerender(historyElement)
assert.ok(fetches.some((url) => url.startsWith('/dsh-git-bar/authors')), 'full author list fetched once')
const authorOptions = findAll(historyTree, (node) => typeof node.props['data-history-option'] === 'string')
assert.deepEqual(
  authorOptions.map((option) => option.props['data-history-option']),
  ['', 'Zoe', 'Ada', 'Bob'],
  'host author list wins over the loaded page, most commits first',
)
authorOptions.find((option) => option.props['data-history-option'] === 'Bob').props.onClick()
await flush()
historyTree = runtime.rerender(historyElement)
assert.ok(
  fetches.some((url) => url.includes('/dsh-git-bar/log') && url.includes('author=Bob')),
  'log refetched with author=Bob',
)
const bobRows = findAll(historyTree, (node) => typeof node.props['data-history-commit'] === 'string')
assert.deepEqual(bobRows.map((row) => row.props['data-history-commit']), ['b0000001'])
console.log('12 author dropdown OK:', bobRows.length, 'row by Bob')

// 13. 滚到底部自动续页：没有手动「加载更多」按钮，滚动到底部就多发一页
const listNode = findAll(historyTree, (node) => node.props['data-history-list'] !== undefined)[0]
assert.equal(typeof listNode.props.onScroll, 'function', 'list listens to scroll')
listNode.props.onScroll({ currentTarget: { scrollTop: 400, clientHeight: 300, scrollHeight: 780 } })
await flush()
historyTree = runtime.rerender(historyElement)
const pagedLog = fetches.filter((url) => url.includes('/dsh-git-bar/log')).at(-1)
assert.ok(pagedLog.includes('limit=60'), `page size stays one page instead of growing: ${pagedLog}`)
assert.ok(
  pagedLog.includes('skip=1'),
  `scroll near the bottom asks for what comes after the loaded commits: ${pagedLog}`,
)
const manualMore = findAll(historyTree, (node) => node.type === 'button' && textOf(node).join('') === 'T:history.more')
assert.equal(manualMore.length, 0, 'no manual load-more button any more')
console.log('13 infinite scroll OK:', pagedLog.slice(pagedLog.indexOf('?')))

// 13b. 续页不能清空已经加载的提交：清空会让列表瞬间变矮，scrollTop 被夹回顶部，
//      表现就是「一滚到底加载更多就跳回最上面」。
//      先切到 author=Ada（重置成第一页、hasMore 为 true），再滚一次触发续页。
const adachip = findAll(historyTree, (node) => node.props['data-history-chip'] === 'author')[0]
adachip.props.onClick()
await flush()
historyTree = runtime.rerender(historyElement)
findAll(historyTree, (node) => node.props['data-history-option'] === 'Ada')[0].props.onClick()
await flush()
historyTree = runtime.rerender(historyElement)
const rowsBeforeMore = findAll(historyTree, (node) => typeof node.props['data-history-commit'] === 'string').length
assert.ok(rowsBeforeMore > 0, `page already has rows: ${rowsBeforeMore}`)
const scrolledList = findAll(historyTree, (node) => node.props['data-history-list'] !== undefined)[0]
scrolledList.props.onScroll({ currentTarget: { scrollTop: 900, clientHeight: 300, scrollHeight: 1200 } })
historyTree = runtime.rerender(historyElement) // 只跑副作用，fetch 还没回来
const rowsDuringMore = findAll(historyTree, (node) => typeof node.props['data-history-commit'] === 'string').length
assert.equal(rowsDuringMore, rowsBeforeMore, 'rows stay mounted while the next page is in flight')
const moreHintDuring = findAll(historyTree, (node) => node.props['data-history-more'] !== undefined)[0]
assert.equal(moreHintDuring?.props['data-history-more'], 'loading', 'footer reports the pending page instead of blanking the list')
await flush()
historyTree = runtime.rerender(historyElement)
const moreHintAfter = findAll(historyTree, (node) => node.props['data-history-more'] !== undefined)[0]
assert.notEqual(moreHintAfter?.props['data-history-more'], 'loading', 'footer goes back to idle once the page lands')
assert.equal(
  findAll(historyTree, (node) => typeof node.props['data-history-commit'] === 'string').length,
  rowsBeforeMore,
  'the landed page renders the same rows for this author',
)
console.log('13b load-more keeps rows OK:', rowsBeforeMore, 'rows')

// 14. 下拉面板：搜索框固定在顶部、选项区自己滚动，键入就过滤
const openBranchChip = () => {
  const chip = findAll(historyTree, (node) => node.props['data-history-chip'] === 'branch')[0]
  chip.props.onClick()
  const tree = runtime.rerender(historyElement)
  historyTree = tree
  return tree
}
openBranchChip()
const menuList = findAll(historyTree, (node) => node.props['data-history-menu-list'] === 'branch')[0]
assert.ok(menuList !== undefined, 'panel renders a dedicated option list')
assert.equal(menuList.props.style.overflowY, 'auto', 'option list scrolls on its own')
assert.equal(menuList.props.style.maxHeight, '240px', 'option list is height-capped')
const menuSearch = findAll(historyTree, (node) => node.props['data-history-menu-search'] === 'branch')[0]
assert.ok(menuSearch !== undefined, 'panel has a search box')
assert.equal(menuSearch.props.autoFocus, true, 'search box takes focus when the panel opens')
assert.equal(menuSearch.props.placeholder, 'history.searchBranch', 'placeholder names what is being searched')
const searchBox = () => findAll(historyTree, (node) => node.props['data-history-menu-search'] === 'branch')[0]
searchBox().props.onChange({ target: { value: 'MAI' } })
historyTree = runtime.rerender(historyElement)
const narrowed = findAll(historyTree, (node) => typeof node.props['data-history-option'] === 'string')
assert.deepEqual(
  narrowed.map((option) => option.props['data-history-option']),
  ['main'],
  'typing narrows the options case-insensitively',
)
searchBox().props.onChange({ target: { value: 'zzz' } })
historyTree = runtime.rerender(historyElement)
assert.equal(
  findAll(historyTree, (node) => typeof node.props['data-history-option'] === 'string').length,
  0,
  'no option survives a miss',
)
assert.ok(textOf(historyTree).join(' ').includes('history.noOption'), 'a miss says so instead of an empty panel')
searchBox().props.onKeyDown({ key: 'Escape' })
historyTree = runtime.rerender(historyElement)
assert.equal(
  findAll(historyTree, (node) => node.props['data-history-menu-list'] !== undefined).length,
  0,
  'Escape closes the panel',
)
console.log('14 panel search + scroll OK')

// 14b. 面板贴住按钮、用 fixed 逃出 overflow:hidden 祖先，并按窗口剩余高度收紧：
//      被祖先裁掉时面板看着在、滚轮却滚不动，所以定位和高度都得管住。
const anchoredChip = findAll(historyTree, (node) => node.props['data-history-chip'] === 'branch')[0]
const openWithRect = (innerHeight) => {
  globalThis.window = { innerHeight }
  anchoredChip.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 24, bottom: 120 }) } })
  const tree = runtime.rerender(historyElement)
  historyTree = tree
  const panel = findAll(tree, (node) => node.props['data-history-menu'] === 'branch')[0]
  const list = findAll(tree, (node) => node.props['data-history-menu-list'] === 'branch')[0]
  return { panel, list }
}
const tall = openWithRect(900)
assert.equal(tall.panel.props.style.position, 'fixed', 'panel escapes overflow:hidden ancestors')
assert.equal(tall.panel.props.style.left, '24px', 'panel lines up with the chip')
assert.equal(tall.panel.props.style.top, '124px', 'panel hangs right under the chip')
assert.equal(tall.list.props.style.height, '240px', 'roomy window: list keeps the full cap')
anchoredChip.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 24, bottom: 120 }) } })
historyTree = runtime.rerender(historyElement)
const short = openWithRect(300)
assert.equal(short.list.props.style.height, '120px', 'short window: list shrinks to the space left below the chip')
assert.equal(short.list.props.style.overflowY, 'auto', 'shrunk list still scrolls')
console.log('14b panel anchoring OK')

// 14c. 下方连最矮的面板都放不下就翻到按钮上方：贴着窗口底边再往下画，整块面板就出屏了。
globalThis.window = { innerHeight: 500, innerWidth: 1200 }
const chipNow = () => findAll(historyTree, (node) => node.props['data-history-chip'] === 'branch')[0]
const lowRect = () => ({ left: 24, top: 400, bottom: 460 })
chipNow().props.onClick({ currentTarget: { getBoundingClientRect: lowRect } })
historyTree = runtime.rerender(historyElement) // 收起上一次的面板
chipNow().props.onClick({ currentTarget: { getBoundingClientRect: lowRect } })
historyTree = runtime.rerender(historyElement)
const flippedPanel = findAll(historyTree, (node) => node.props['data-history-menu'] === 'branch')[0]
const flippedList = findAll(historyTree, (node) => node.props['data-history-menu-list'] === 'branch')[0]
assert.equal(flippedPanel.props.style.top, 'auto', 'panel flips above the chip when there is no room below')
assert.equal(flippedPanel.props.style.bottom, '104px', 'flipped panel sits right above the chip')
assert.equal(flippedList.props.style.height, '240px', 'flipped panel keeps the full cap')
assert.equal(flippedPanel.props.style.zIndex, '1200', 'panel outranks the host UI it is portaled over')
let stoppedWheel = 0
flippedPanel.props.onWheel({ stopPropagation: () => { stoppedWheel += 1 } })
assert.equal(stoppedWheel, 1, 'a wheel inside the panel never reaches the host scrolling container')
chipNow().props.onClick({ currentTarget: { getBoundingClientRect: lowRect } })
historyTree = runtime.rerender(historyElement)
console.log('14c panel flips above the chip OK')

// 14d. 浮层该不该离场：有 react-dom 就 portal 到 body（祖先的 transform/overflow 才拽不住它），
//      没有就地渲染——测试运行时就是后者，28 条断言全靠它才跑得通。
const plainNode = { type: 'div', props: {}, children: [] }
assert.equal(plugin.portalToBody(plainNode), plainNode, 'without react-dom the panel renders in place')
const portaled = globalThis.__captured.factory((id) =>
  id === 'react-dom' ? { createPortal: (node, target) => ({ type: '__portal__', props: { target }, children: [node] }) } : runtime.React,
)
const hoisted = portaled.portalToBody(plainNode)
assert.equal(hoisted.type, '__portal__', 'with react-dom the panel leaves through a portal')
assert.equal(hoisted.props.target, globalThis.document.body, 'the portal target is document.body')
assert.equal(hoisted.children[0], plainNode, 'the panel itself is unchanged inside the portal')
console.log('14d panel portal OK')
globalThis.window = undefined

// 15. /authors 拉不到时退回已加载提交里的作者，筛选照常可用
authorsMode = 'fail'
historyTree = runtime.mount(historyElement)
await flush()
historyTree = runtime.rerender(historyElement)
findAll(historyTree, (node) => node.props['data-history-chip'] === 'author')[0].props.onClick()
await flush()
historyTree = runtime.rerender(historyElement)
const fallbackOptions = findAll(historyTree, (node) => typeof node.props['data-history-option'] === 'string')
assert.deepEqual(
  fallbackOptions.map((option) => option.props['data-history-option']),
  ['', 'Ada', 'Bob'],
  'a failed author list falls back to the loaded commits',
)
console.log('15 author fallback OK:', fallbackOptions.length, 'options')

// 16. 历史比一页更长：滚到底继续加载，列表是累积的，也不会每页都拿回同一批。
//     只把 limit 越加越大时每页返回的都是同一批提交，列表就永远卡在 Host 的上限上——
//     这正是「300 个提交之后再也加载不出来」的成因。
logMode = 'paging'
historyTree = runtime.mount(historyElement)
await flush()
historyTree = runtime.rerender(historyElement)
const historyRows = () => findAll(historyTree, (node) => typeof node.props['data-history-commit'] === 'string')
const scrollToBottom = () => {
  findAll(historyTree, (node) => node.props['data-history-list'] !== undefined)[0].props.onScroll({
    currentTarget: { scrollTop: 900, clientHeight: 300, scrollHeight: 1200 },
  })
}
const logCalls = () => fetches.filter((url) => url.includes('/dsh-git-bar/log')).length
assert.equal(historyRows().length, 60, 'the first page holds exactly one page of commits')
scrollToBottom()
await flush()
historyTree = runtime.rerender(historyElement)
assert.equal(historyRows().length, 120, 'the next page is appended, not swapped in')
const secondPage = fetches.filter((url) => url.includes('/dsh-git-bar/log')).at(-1)
assert.ok(secondPage.includes('skip=60'), `the second page asks for the commits after the first: ${secondPage}`)
scrollToBottom()
await flush()
historyTree = runtime.rerender(historyElement)
const loadedHashes = historyRows().map((row) => row.props['data-history-commit'])
assert.equal(loadedHashes.length, 130, 'the last page tops the list off')
assert.equal(new Set(loadedHashes).size, 130, 'no commit is listed twice')
assert.deepEqual([loadedHashes[0], loadedHashes.at(-1)], ['h0000000', 'h0000129'], 'pages keep the host order')
const callsBeforeIdle = logCalls()
scrollToBottom()
await flush()
historyTree = runtime.rerender(historyElement)
assert.equal(logCalls(), callsBeforeIdle, 'a fully loaded history asks for nothing more')
assert.equal(historyRows().length, 130)
console.log('16 skip paging OK:', loadedHashes.length, 'commits over 3 pages')

console.log('\nALL INTERACTION TESTS PASSED')
