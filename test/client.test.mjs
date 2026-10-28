import assert from 'node:assert/strict'

let captured
let stateOverride
const ReactFake = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) { return [stateOverride === undefined ? initial : stateOverride, () => {}] },
  useEffect() {},
  useRef() { return { current: null } },
  useMemo(factory) { return factory() },
}

globalThis.window = {
  __ModuleLoader__: { load(definition) { captured = definition } },
  location: { protocol: 'http:', origin: 'http://127.0.0.1:65337' },
  setInterval: () => 1,
  clearInterval: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.document = { visibilityState: 'visible' }

await import('../client.js')

assert.ok(captured, 'module definition captured')
assert.equal(captured.id, 'dsh-git-bar')
console.log('1 module id OK:', captured.id)

const plugin = captured.factory((specifier) => {
  assert.equal(specifier, 'react')
  return ReactFake
})
assert.deepEqual(plugin.inject, ['slots'])
assert.equal(typeof plugin.apply, 'function')
console.log('2 plugin shape OK')

// --- apply(): slot registration ---
// 插件现在注册两个座位（输入框上方的状态条 + 主对话区的「Git 历史」标签页），
// 所以按座位名分开存，别再靠「最后一次注册」这种顺序假设。
const registrations = new Map()
const injectedSlots = []
const ctx = {
  get(name) {
    if (name === 'locale') {
      return { register: () => () => {}, bind: () => (key) => `T:${key}` }
    }
    if (name === 'sessions') {
      return { list: { getSnapshot: () => ({ byId: { 'session-1': { cwd: '/tmp/repo' } } }) } }
    }
    return undefined
  },
  effect: (fn) => fn(),
  slots: {
    inject(slotName, callback) { injectedSlots.push(slotName); return callback() },
    register(options, component) {
      registrations.set(options.name, { options, component })
      return () => {}
    },
  },
}
plugin.apply(ctx)
const dockRegistration = registrations.get('conversation.input.dock')
const viewRegistration = registrations.get('conversation.view')
assert.deepEqual(injectedSlots, ['conversation.input.dock', 'conversation.view'], 'two seats injected')
assert.ok(dockRegistration !== undefined, 'dock seat registered')
assert.ok(viewRegistration !== undefined, 'conversation.view seat registered')
const injectedSlot = 'conversation.input.dock'
const registeredOptions = dockRegistration.options
const registeredComponent = dockRegistration.component
assert.equal(injectedSlot, 'conversation.input.dock')
assert.equal(registeredOptions.name, 'conversation.input.dock')
assert.equal(registeredOptions.id, 'git-bar')
assert.equal(registeredOptions.order, 20)
assert.equal(typeof registeredOptions.inject, 'function')
console.log('3 slot registration OK:', injectedSlot, registeredOptions.id)

// injected props
const props = registeredOptions.inject('session-1')
assert.equal(props.sessionId, 'session-1')
assert.equal(props.readCwd(), '/tmp/repo')
assert.equal(props.t('label.clean'), 'T:label.clean')
console.log('4 injected props OK')

function textOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) textOf(child, out); return out }
  if (typeof node === 'object') { for (const child of node.children ?? []) textOf(child, out) }
  return out
}

const repository = {
  root: '/tmp/repo', name: 'repo', branch: 'main', detached: false, sha: 'a1b2c3d',
  dirty: { changed: 3, staged: 1, unstaged: 1, untracked: 1 },
  upstream: 'origin/main', ahead: 2, behind: 1,
  worktree: { linked: true, mainRoot: '/tmp/main' },
}

stateOverride = { phase: 'ready', body: { dir: '/tmp/repo', repository } }
let text = textOf(registeredComponent(props)).join(' ')
for (const expected of ['main', 'repo', '3 T:label.changed', '↑2 ↓1', 'T:label.worktree', 'a1b2c3d']) {
  assert.ok(text.includes(expected), `ready render is missing ${JSON.stringify(expected)} in ${JSON.stringify(text)}`)
}
console.log('5 ready render OK:', text)

stateOverride = { phase: 'ready', body: { dir: '/tmp/plain', repository: null, reason: 'not-a-repository' } }
text = textOf(registeredComponent(props)).join(' ')
assert.ok(text.includes('T:label.notRepository'), text)
assert.ok(text.includes('plain'), text)
console.log('6 not-a-repository render OK:', text)

stateOverride = { phase: 'failed', message: 'HTTP 401' }
text = textOf(registeredComponent(props)).join(' ')
assert.ok(text.includes('T:label.unavailable'), text)
console.log('7 failed render OK:', text)

stateOverride = { phase: 'ready', body: { dir: '/tmp/clean', repository: { ...repository, dirty: { changed: 0, staged: 0, unstaged: 0, untracked: 0 }, ahead: 0, behind: 0, branch: null, detached: true, sha: null, worktree: { linked: false, mainRoot: '/tmp/clean' } } } }
text = textOf(registeredComponent(props)).join(' ')
assert.ok(text.includes('T:label.detached'), text)
assert.ok(text.includes('T:label.clean'), text)
assert.ok(!text.includes('T:label.worktree'), text)
console.log('8 detached + clean render OK:', text)

stateOverride = { phase: 'loading' }
assert.equal(registeredComponent(props), null)
console.log('9 loading renders nothing OK')

// --- 可选中复制 / hash 跳远端 / 工作树入口 ---
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (typeof node === 'object') {
    if (predicate(node)) out.push(node)
    for (const child of node.children ?? []) findAll(child, predicate, out)
  }
  return out
}

// 10. 状态条内的文字必须可以选中复制
stateOverride = { phase: 'ready', body: { dir: '/tmp/repo', repository } }
const barNode = findAll(registeredComponent(props), (node) => node.props?.role === 'status')[0]
assert.ok(barNode !== undefined, 'bar rendered')
assert.equal(barNode.props.style.userSelect, 'text')
assert.equal(barNode.props.style.WebkitUserSelect, 'text')
console.log('10 selectable bar OK')

// 11. 有远端时 hash 是一个打开 commit 页的按钮
const commitUrl = 'https://github.com/owner/repo/commit/abc123'
stateOverride = { phase: 'ready', body: { dir: '/tmp/repo', repository: { ...repository, commitUrl } } }
let shaNode = findAll(registeredComponent(props), (node) => node.props?.['data-git-bar-commit'] !== undefined)[0]
assert.ok(shaNode !== undefined, 'commit trigger rendered')
assert.equal(shaNode.type, 'button')
assert.equal(shaNode.props.title, commitUrl)
assert.deepEqual(textOf(shaNode), ['a1b2c3d'])
console.log('11 commit trigger OK')

// 12. 没有远端时 hash 退回纯文本
stateOverride = { phase: 'ready', body: { dir: '/tmp/repo', repository: { ...repository, commitUrl: null } } }
const bare = registeredComponent(props)
assert.equal(findAll(bare, (node) => node.props?.['data-git-bar-commit'] !== undefined).length, 0)
assert.ok(findAll(bare, (node) => node.type === 'span' && textOf(node).join('') === 'a1b2c3d').length > 0, 'hash is plain text')
console.log('12 no remote: plain hash OK')

// 13. 工作树标签是弹层按钮；只有一个工作树时不出现
let wtNode = findAll(registeredComponent(props), (node) => node.props?.['data-git-bar-worktrees-trigger'] !== undefined)[0]
assert.ok(wtNode !== undefined, 'worktree trigger rendered')
assert.equal(wtNode.type, 'button')
assert.equal(wtNode.props['aria-haspopup'], 'dialog')
stateOverride = { phase: 'ready', body: { dir: '/tmp/main', repository: { ...repository, worktree: { linked: false, mainRoot: '/tmp/main', count: 3 } } } }
wtNode = findAll(registeredComponent(props), (node) => node.props?.['data-git-bar-worktrees-trigger'] !== undefined)[0]
assert.deepEqual(textOf(wtNode), ['T:worktree.count'])
stateOverride = { phase: 'ready', body: { dir: '/tmp/main', repository: { ...repository, worktree: { linked: false, mainRoot: '/tmp/main', count: 1 } } } }
assert.equal(findAll(registeredComponent(props), (node) => node.props?.['data-git-bar-worktrees-trigger'] !== undefined).length, 0)
console.log('13 worktree trigger OK')

// 14. conversation.view 座位：标签走词典，props 带 sessionId 与 cwd 读取器
assert.equal(viewRegistration.options.name, 'conversation.view')
assert.equal(viewRegistration.options.id, 'git-history')
assert.equal(viewRegistration.options.order, 20)
assert.equal(viewRegistration.options.locale, 'git-bar')
assert.equal(viewRegistration.options.label(), 'T:history.tab')
const viewProps = viewRegistration.options.inject('session-1')
assert.equal(viewProps.sessionId, 'session-1')
assert.equal(viewProps.readCwd(), '/tmp/repo')
assert.equal(viewProps.t('history.title'), 'T:history.title')
console.log('14 conversation.view seat OK:', viewRegistration.options.id)

// --- 分叉图谱布局（纯函数） ---
// 15. 直线历史：一条 lane 一条线，尖端上面不该有线
const linear = plugin.layoutGraph([
  { hash: 'c3', parents: ['c2'] },
  { hash: 'c2', parents: ['c1'] },
  { hash: 'c1', parents: [] },
])
assert.deepEqual(linear.map((row) => row.lane), [0, 0, 0])
assert.deepEqual(linear.map((row) => row.color), [0, 0, 0])
assert.deepEqual(linear[0].edges.map((edge) => edge.kind), ['out'])
assert.deepEqual(linear[1].edges.map((edge) => edge.kind), ['into', 'out'])
assert.deepEqual(linear[2].edges.map((edge) => edge.kind), ['into'])
assert.equal(plugin.graphLaneCount(linear), 1)
console.log('15 linear graph OK:', JSON.stringify(linear.map((row) => row.edges.map((edge) => edge.kind))))

// 16. 分叉 + 合并：第二条 lane 有自己的颜色，合并提交把线收回第一条
const merge = plugin.layoutGraph([
  { hash: 'm', parents: ['a', 'b'] },
  { hash: 'a', parents: ['base'] },
  { hash: 'b', parents: ['base'] },
  { hash: 'base', parents: [] },
])
assert.equal(merge[0].merge, true, 'merge commit flagged')
assert.deepEqual(merge[0].edges.map((edge) => edge.to), [0, 1])
assert.deepEqual(merge[0].edges.map((edge) => edge.color), [0, 1])
assert.deepEqual(merge[1].edges.map((edge) => edge.kind), ['into', 'pass', 'out'])
assert.deepEqual(merge[2].edges.map((edge) => edge.kind), ['pass', 'into', 'out'])
assert.equal(merge[2].edges[1].from, 1, 'second branch lands on its own lane')
assert.equal(merge[2].edges[2].from, 1)
assert.equal(merge[2].edges[2].to, 0, 'merged line folds back into lane 0')
assert.deepEqual(merge[3].edges.map((edge) => edge.kind), ['into'])
assert.equal(plugin.graphLaneCount(merge), 2)
assert.equal(merge[1].edges[1].color, 1, 'pass-through keeps the branch colour')
console.log('16 merge graph OK: lanes', plugin.graphLaneCount(merge))

// 17. 历史视图首屏：没有数据时渲染等待文案，不抛异常
stateOverride = undefined
const historyProps = viewRegistration.options.inject('session-1')
const historyTree = viewRegistration.component(historyProps)
assert.ok(historyTree !== undefined, 'history view rendered')
assert.equal(historyTree.props['data-dsh-git-bar-history'], '')
const historyText = textOf(historyTree).join(' ')
assert.ok(historyText.includes('T:history.title'), historyText)
assert.ok(historyText.includes('T:history.loading'), historyText)
console.log('17 history view first paint OK:', historyText)

// 18. 筛选栏：分支 / 提交人两个下拉；未筛选时不出现「重置」
const filterBar = findAll(historyTree, (node) => node.props['data-history-filters'] !== undefined)[0]
assert.ok(filterBar !== undefined, 'filter row rendered')
const chips = findAll(filterBar, (node) => typeof node.props['data-history-chip'] === 'string')
assert.deepEqual(chips.map((chip) => chip.props['data-history-chip']), ['branch', 'author'])
assert.deepEqual(textOf(chips[0]), ['T:history.allBranches'])
assert.deepEqual(textOf(chips[1]), ['T:history.allAuthors'])
assert.equal(findAll(filterBar, (node) => node.props['data-history-reset'] !== undefined).length, 0)
console.log('18 filter row OK:', chips.length, 'chips')

console.log('\nALL CLIENT TESTS PASSED')
