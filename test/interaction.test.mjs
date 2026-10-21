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
  let pass = 0
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
    useEffect(fn) {
      if (pass === 0) effects.push(fn)
    },
    useLayoutEffect(fn) {
      if (pass === 0) effects.push(fn)
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

  function render() {
    const tree = walk(current.element, 'root')
    if (pass === 0) {
      const pending = effects
      effects = []
      pass += 1
      for (const effect of pending) effect()
      return walk(current.element, 'root')
    }
    return tree
  }

  return {
    mount(element) {
      current = { element }
      pass = 0
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
globalThis.fetch = async (url) => {
  const text = String(url)
  fetches.push(text)
  if (text.startsWith('/dsh-git-bar/worktrees')) return { ok: true, json: async () => worktreeReply }
  if (text.startsWith('/dsh-git-bar/branches')) return { ok: true, json: async () => branchReply }
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

let slotComponent
let slotOptions
const ctx = {
  get: (name) => services[name],
  effect: (fn) => fn(),
  slots: {
    inject: (_name, callback) => callback(),
    register: (options, component) => {
      slotOptions = options
      slotComponent = component
      return () => {}
    },
  },
}
plugin.apply(ctx)
assert.ok(slotComponent !== undefined, 'component registered')

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

console.log('\nALL INTERACTION TESTS PASSED')
