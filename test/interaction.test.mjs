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
globalThis.fetch = async (url) => {
  const text = String(url)
  fetches.push(text)
  if (text.startsWith('/dsh-git-bar/worktrees')) return { ok: true, json: async () => worktreeReply }
  if (text.startsWith('/dsh-git-bar/branches')) return { ok: true, json: async () => branchReply }
  if (text.startsWith('/dsh-git-bar/commit-diff')) return { ok: true, json: async () => commitDiffReply }
  if (text.startsWith('/dsh-git-bar/commit')) return { ok: true, json: async () => commitReply }
  if (text.startsWith('/dsh-git-bar/log')) return { ok: true, json: async () => logReplyFor(text) }
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

const services = {
  workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', path: '/repo' }, { workspaceId: 'ws-2', path: '/repo-link' }] }) } },
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
assert.deepEqual(rows.map((row) => row.props['data-worktree']), ['/repo', '/repo-link', '/repo-hotfix'])
console.log('1 worktree popover OK:', rows.length, 'rows')

// 2. 当前工作树没有“在此新建会话”，其余两个有
const openers = findAll(tree, (node) => typeof node.props['data-worktree-open'] === 'string')
assert.deepEqual(openers.map((node) => node.props['data-worktree-open']), ['/repo', '/repo-hotfix'])
console.log('2 open actions OK:', openers.length)

// 3. 点“在此新建会话”把目录交给宿主：已注册的工作区才会真的开
openers[0].props.onClick()
await flush()
assert.deepEqual(requests, ['open:ws-1'])

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

// 12. 提交人下拉：候选来自已加载的提交，选中后带 author 参数重拉
const authorChip = findAll(historyTree, (node) => node.props['data-history-chip'] === 'author')[0]
authorChip.props.onClick()
historyTree = runtime.rerender(historyElement)
const authorOptions = findAll(historyTree, (node) => typeof node.props['data-history-option'] === 'string')
assert.deepEqual(
  authorOptions.map((option) => option.props['data-history-option']),
  ['', 'Ada', 'Bob'],
  'authors collected from the loaded commits',
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
assert.ok(pagedLog.includes('limit=120'), `scroll near the bottom asks for the next page: ${pagedLog}`)
const manualMore = findAll(historyTree, (node) => node.type === 'button' && textOf(node).join('') === 'T:history.more')
assert.equal(manualMore.length, 0, 'no manual load-more button any more')
console.log('13 infinite scroll OK:', pagedLog.slice(pagedLog.indexOf('?')))

console.log('\nALL INTERACTION TESTS PASSED')
