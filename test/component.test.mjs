// Component test harness for <md-collab-editor> (audit T-1): mounts the REAL
// web component in jsdom with the REAL TipTap editor and a real
// HocuspocusProvider whose network is stubbed at the WebSocket boundary
// (never connects — server broadcasts are driven through the same entry
// points the provider uses). Covers the wiring the unit tests cannot:
// toolbar/role-select/save-bar DOM, config broadcasts, dirty tracking,
// read-only toggling (N-2 regression), session-expired, role chips.
import { JSDOM } from 'jsdom'

let fail = 0
function check(name, ok, extra = '') {
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : `→ ${JSON.stringify(extra)}`)
}

// --- jsdom + network stub -------------------------------------------------------
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000/' })
global.window = dom.window
global.document = dom.window.document
for (const k of ['HTMLElement', 'customElements', 'CustomEvent', 'Node', 'Option',
  'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'DOMParser', 'Range',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'location']) {
  if (dom.window[k] !== undefined) global[k] = dom.window[k]
}
global.requestAnimationFrame ||= (cb) => setTimeout(cb, 0)
try { Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }) } catch { /* keep node's */ }
dom.window.confirm = () => true
global.confirm = dom.window.confirm

/** Never-connecting WebSocket: the provider queues everything it sends. */
class FakeWebSocket {
  constructor(url) { this.url = url; this.readyState = 0 }
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
globalThis.WebSocket = FakeWebSocket
dom.window.WebSocket = FakeWebSocket

await import('../src/md-collab-editor.js') // registers the custom element

function mount(attrs = {}) {
  const el = document.createElement('md-collab-editor')
  el.setAttribute('document-name', 'test-node')
  el.setAttribute('websocket-url', 'ws://localhost:9/collab')
  el.setAttribute('user-name', 'Tester')
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.appendChild(el)
  return el
}
const saveDot = (el) => el.querySelector('.mce-save-dot').dataset.state
const saveBtn = (el) => el.querySelector('.mce-save-btn')

// Server-side config broadcast as the collab server sends it (via the same
// stateless entry point the provider delivers payloads to)
function serverConfig(el, extra = {}) {
  el._onStateless(JSON.stringify({
    event: 'config', saveDebounceMs: 15000, saveMaxDebounceMs: 90000,
    autosave: true, canPersist: true, dirty: false, ...extra,
  }))
}

// --- 1) mount: toolbar, role select, save bar, hidden AI button ------------------
const ed = mount()
check('editor mounts (ProseMirror view present)', Boolean(ed.querySelector('.ProseMirror')))
check('toolbar renders its formatting buttons', ed.querySelectorAll('.mce-toolbar button').length > 10)
const roleSelect = ed.querySelector('.mce-role-select')
check('role select offers placeholder + clear + full 112-role catalog',
  roleSelect && roleSelect.querySelectorAll('option').length === 114, roleSelect?.length)
check('save bar starts read-only (no session → cannot persist)', saveDot(ed) === 'readonly', saveDot(ed))
check('AI button hidden until the server reports a configured model',
  ed.querySelector('.mce-ai-btn').style.display === 'none')

// --- 2) server config broadcast → save bar, AI button, locked chips --------------
let saveStates = []
ed.addEventListener('save-state-change', (e) => saveStates.push(e.detail))
serverConfig(ed, { aiAvailable: true, plainKeywords: ['Mechanik', 'Optik'] })
check('config: save bar switches to saved/no-changes', saveDot(ed) === 'saved', saveDot(ed))
check('config: AI button becomes visible', ed.querySelector('.mce-ai-btn').style.display === '')
check('config: plain editorial keywords render as locked chips',
  ed.querySelector('.mce-entities').textContent.includes('Mechanik')
  && ed.querySelectorAll('.mce-entities .mce-chip-locked, .mce-entities [class*="locked"]').length >= 2,
  ed.querySelector('.mce-entities').textContent)
check('config: save-state-change event carries canPersist',
  saveStates.at(-1)?.canPersist === true, saveStates.at(-1))

// --- 3) editing after sync → dirty/countdown → saved broadcast clears ------------
ed.provider.emit('synced')
ed.editor.commands.insertContent('Hallo Welt. ')
check('typing after sync: save bar counts down (pending)', saveDot(ed) === 'pending', saveDot(ed))
check('typing after sync: manual save button becomes enabled', !saveBtn(ed).disabled)
const sent = []
ed.provider.sendStateless = (p) => sent.push(JSON.parse(p))
saveBtn(ed).click()
check('save click sends the stateless save command', sent.some((m) => m.event === 'save'), sent)
ed._onStateless(JSON.stringify({ event: 'saved', at: new Date().toISOString() }))
check('saved broadcast: bar returns to saved, button disabled',
  saveDot(ed) === 'saved' && saveBtn(ed).disabled, saveDot(ed))

// --- 4) save-error broadcast → error state with message --------------------------
ed._onStateless(JSON.stringify({ event: 'save-error', message: 'Kein Schreibrecht' }))
check('save-error broadcast: bar shows the error state', saveDot(ed) === 'error', saveDot(ed))
check('save-error broadcast: message lands in the tooltip',
  ed.querySelector('.mce-save-text').title === 'Kein Schreibrecht')
ed._onStateless(JSON.stringify({ event: 'saved', at: new Date().toISOString() }))

// --- 5) N-2 regression: read-only toggle must not fake a document change ---------
const dotBefore = saveDot(ed)
ed.setAttribute('read-only', 'true')
check('read-only toggle: save bar unchanged (no fake dirty)', saveDot(ed) === dotBefore, saveDot(ed))
check('read-only toggle: editor becomes non-editable', ed.editor.isEditable === false)
check('read-only toggle: role select disabled', roleSelect.disabled === true)
ed.setAttribute('read-only', 'false')
check('read-only back: still no fake dirty', saveDot(ed) === dotBefore, saveDot(ed))
check('read-only back: editor editable again', ed.editor.isEditable === true)

// --- 6) role select → roleBlock in the doc → amber chips (remove works) ----------
ed.editor.commands.setTextSelection(2)
roleSelect.value = 'einleitung'
roleSelect.dispatchEvent(new dom.window.Event('change'))
check('role select wraps the block (chip appears)',
  ed.querySelectorAll('.mce-role-chip').length === 1
  && ed.querySelector('.mce-role-chip-label').textContent === 'Einleitung',
  ed.querySelector('.mce-roles').textContent)
check('role select mirrors the active role', roleSelect.value === 'einleitung')
ed.querySelector('.mce-role-chip-del').click()
check('chip ✕ removes the role again (bar hides)',
  ed.querySelectorAll('.mce-role-chip').length === 0
  && ed.querySelector('.mce-roles').style.display === 'none')

// --- 7) session-expired: rejected token → status event, no reconnect loop --------
const statuses = []
ed.addEventListener('status-change', (e) => statuses.push(e.detail.status))
ed.provider.emit('authenticationFailed', { reason: 'permission-denied' })
check('authenticationFailed → status-change "session-expired"',
  statuses.includes('session-expired'), statuses)

// --- 8) teardown ------------------------------------------------------------------
ed.remove()
check('disconnect: component destroys the editor', ed.editor.isDestroyed === true)

process.exit(fail ? 1 : 0)
