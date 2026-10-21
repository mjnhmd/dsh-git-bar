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
let injectedSlot, registeredOptions, registeredComponent
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
    inject(slotName, callback) { injectedSlot = slotName; return callback() },
    register(options, component) {
      registeredOptions = options
      registeredComponent = component
      return () => {}
    },
  },
}
plugin.apply(ctx)
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

console.log('\nALL CLIENT TESTS PASSED')
