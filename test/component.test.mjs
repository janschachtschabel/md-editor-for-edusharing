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
// jsdom implements neither Range.getClientRects nor getBoundingClientRect —
// ProseMirror's (async) scrollToSelection needs both after text selections
const zeroRect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }
dom.window.Range.prototype.getBoundingClientRect = () => zeroRect
dom.window.Range.prototype.getClientRects = () => Object.assign([zeroRect], { item: (i) => (i === 0 ? zeroRect : null) })
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

// --- 8) in-content TOC: button inserts a linked directory INTO the document ------
ed.editor.commands.setContent('<h1>Alpha</h1><p>Text eins.</p><h2>Beta Titel</h2><p>Text zwei.</p><h2>Über Ätzung</h2><p>Text drei.</p>')
const tocBtn = ed.querySelector('.mce-toc-btn')
check('TOC button exists in the toolbar', Boolean(tocBtn))
tocBtn.click()
const tocMd = ed.getMarkdown()
check('TOC block inserted at the TOP as ::: inhaltsverzeichnis',
  tocMd.trimStart().startsWith('::: inhaltsverzeichnis'), tocMd.slice(0, 60))
check('TOC entries are standard markdown links with GitHub-style slugs',
  tocMd.includes('[Alpha](#alpha)') && tocMd.includes('[Beta Titel](#beta-titel)'), tocMd)
check('umlauts survive in the slug (GitHub convention)',
  tocMd.includes('[Über Ätzung](#über-ätzung)'), tocMd)
check('level 2 is NESTED under level 1',
  /^- +\[Alpha\]/m.test(tocMd) && /^ +- +\[Beta Titel\]/m.test(tocMd), tocMd)
check('the TOC does not list its own heading',
  !/\]\(#inhaltsverzeichnis\)/.test(tocMd), tocMd)
ed.editor.commands.insertContentAt(ed.editor.state.doc.content.size, '<h2>Gamma</h2>')
tocBtn.click()
const tocMd2 = ed.getMarkdown()
check('second click UPDATES the directory instead of duplicating it',
  (tocMd2.match(/^::: inhaltsverzeichnis$/m) || []).length === 1
  && tocMd2.includes('[Gamma](#gamma)'), tocMd2)
// jump marks: clicking an anchor link in the editor jumps to its heading
const anchor = [...ed.querySelectorAll('.mce-editor a')].find((a) => a.getAttribute('href') === '#beta-titel')
check('anchor links are rendered in the editor', Boolean(anchor))
anchor.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
check('clicking a TOC link jumps to its heading',
  ed.editor.state.selection.$from.parent.textContent === 'Beta Titel',
  ed.editor.state.selection.$from.parent.textContent)
// jumping must also work in viewer mode (read view keeps the links usable)
ed.setAttribute('viewer', 'true')
const anchorAlpha = [...ed.querySelectorAll('.mce-editor a')].find((a) => a.getAttribute('href') === '#alpha')
anchorAlpha.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
check('anchor jump works in viewer mode too',
  ed.editor.state.selection.$from.parent.textContent === 'Alpha')
ed.setAttribute('viewer', 'false')

// --- 9) viewer mode: externally controlled read view (attribute) -----------------
ed.setAttribute('viewer', 'true')
check('viewer: component gets the viewer class', ed.classList.contains('mce-viewer'))
check('viewer: toolbar is hidden', ed.querySelector('.mce-toolbar').hidden === true)
check('viewer: editor is not editable', ed.editor.isEditable === false)
ed.setAttribute('viewer', 'false')
check('viewer off: toolbar back, editable again',
  ed.querySelector('.mce-toolbar').hidden === false && ed.editor.isEditable === true)
ed.setAttribute('read-only', 'true')
ed.setAttribute('viewer', 'true')
ed.setAttribute('viewer', 'false')
check('viewer off while read-only: stays non-editable (read-only wins)',
  ed.editor.isEditable === false)
ed.setAttribute('read-only', 'false')

// --- 10) glossary: button appends an entity glossary, updates idempotently -------
ed.editor.commands.setContent('<p>Die Kartoffel wächst in Weimar.</p>')
check('glossary setup: two entities tagged',
  ed.addAnnotation({ quote: 'Weimar', type: 'Ort' }) === null
  && ed.addAnnotation({ quote: 'Kartoffel', type: 'Thema' }) === null)
check('tagging the SAME entity again is rejected (no duplicate pill)',
  typeof ed.addAnnotation({ quote: 'Weimar', type: 'Ort' }) === 'string'
  && ed.getAnnotations().length === 2, ed.getAnnotations().length)
const glossBtn = ed.querySelector('.mce-glossary-btn')
check('glossary button exists in the toolbar', Boolean(glossBtn))
glossBtn.click()
const glossMd = ed.getMarkdown()
check('glossary block appended at the end (::: glossar)',
  /::: glossar[\s\S]*## Glossar[\s\S]*- +\*\*Kartoffel\*\* \(Thema\)[\s\S]*- +\*\*Weimar\*\* \(Ort\)[\s\S]*:::/.test(glossMd), glossMd)
check('glossary entries are sorted alphabetically',
  glossMd.indexOf('**Kartoffel**') < glossMd.indexOf('**Weimar**'))
glossBtn.click()
check('second click UPDATES the glossary instead of duplicating it',
  (ed.getMarkdown().match(/^::: glossar$/m) || []).length === 1, ed.getMarkdown())

// --- 11) find & replace -----------------------------------------------------------
ed.editor.commands.setContent('<p>Die Kartoffel und das kartoffelige Feld: noch eine Kartoffel.</p>')
const findBtn = ed.querySelector('.mce-find-btn')
check('find button exists in the toolbar', Boolean(findBtn))
findBtn.click()
const findBar = ed.querySelector('.mce-find')
check('find bar opens', findBar && !findBar.hidden)
const findInput = ed.querySelector('.mce-find-input')
findInput.value = 'kartoffel'
findInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
check('search counts matches case-insensitively',
  ed.querySelector('.mce-find-count').textContent.includes('3'),
  ed.querySelector('.mce-find-count').textContent)
ed.querySelector('.mce-find-next').click()
const sel1 = ed.editor.state.selection
check('next selects the first match',
  ed.editor.state.doc.textBetween(sel1.from, sel1.to) === 'Kartoffel')
ed.querySelector('.mce-find-replace-input').value = 'Erdapfel'
ed.querySelector('.mce-find-replace').click()
check('replace swaps the selected match only',
  ed.editor.state.doc.textContent.startsWith('Die Erdapfel und das kartoffelige'),
  ed.editor.state.doc.textContent)
ed.querySelector('.mce-find-replace-all').click()
check('replace all swaps the remaining matches',
  ed.editor.state.doc.textContent === 'Die Erdapfel und das Erdapfelige Feld: noch eine Erdapfel.',
  ed.editor.state.doc.textContent)
findInput.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
check('Escape closes the find bar', findBar.hidden === true)

// --- 12) word count / reading time ------------------------------------------------
ed.editor.commands.setContent('<p>Eins zwei drei vier fünf sechs sieben.</p>')
await new Promise((r) => setTimeout(r, 1200)) // wordcount updates with the 1s debounce
const wc = ed.querySelector('.mce-wordcount')
check('word count element shows the current words', Boolean(wc) && wc.textContent.includes('7'), wc?.textContent)

// --- 13) deep links: public jumpToAnchor() ----------------------------------------
ed.editor.commands.setContent('<h1>Alpha</h1><p>Text.</p><h2>Ziel Punkt</h2><p>Mehr Text.</p>')
check('jumpToAnchor jumps to the slug heading',
  ed.jumpToAnchor('ziel-punkt') === true
  && ed.editor.state.selection.$from.parent.textContent === 'Ziel Punkt')
check('jumpToAnchor returns false for unknown slugs', ed.jumpToAnchor('gibt-es-nicht') === false)

// --- 14) presence chips: other users are clickable jump targets -------------------
ed.provider.emit('awarenessUpdate', { states: [
  { clientId: ed.provider.document.clientID, user: { name: 'Ich', color: '#111' } },
  { clientId: 424242, user: { name: 'Kollegin', color: '#222' }, cursor: null },
] })
const chips = [...ed.querySelectorAll('.mce-users .mce-chip')]
check('presence: own chip is not a button, other user chip is',
  chips.length === 2 && chips[0].tagName === 'SPAN' && chips[1].tagName === 'BUTTON',
  chips.map((c) => c.tagName))
chips[1].click() // no cursor state behind the fake id → must be a graceful no-op
check('presence: jump click without cursor state does not throw', true)

// --- 15) AI review panel: suggestions → user selection → ai-apply -----------------
const sentAi = []
ed.provider.sendStateless = (p) => sentAi.push(JSON.parse(p))
ed._onStateless(JSON.stringify({
  event: 'ai-status', phase: 'review',
  entities: [{ quote: 'Alpha', type: 'Ort' }, { quote: 'Beta', type: 'Person' }],
  roles: [{ quote: 'Text.', role: 'einleitung', endQuote: 'Ende gut.' }],
}))
const reviewBar = ed.querySelector('.mce-ai-review')
let boxes = [...ed.querySelectorAll('.mce-ai-review input[type="checkbox"]')]
check('AI review panel opens listing every suggestion (all pre-checked)',
  reviewBar && !reviewBar.hidden && boxes.length === 3 && boxes.every((b) => b.checked),
  boxes.length)
check('AI review shows the translated role label',
  ed.querySelector('.mce-ai-review').textContent.includes('Einleitung'))
check('AI review shows the RANGE of multi-paragraph roles (endQuote visible)',
  ed.querySelector('.mce-ai-review').textContent.includes('Ende gut.'),
  ed.querySelector('.mce-ai-review').textContent.slice(0, 160))
boxes[1].checked = false // reject "Beta"
ed.querySelector('.mce-ai-review-apply').click()
check('apply sends ai-apply with ONLY the kept indices',
  sentAi.some((m) => m.event === 'ai-apply'
    && JSON.stringify(m.keepEntities) === '[0]' && JSON.stringify(m.keepRoles) === '[0]'),
  sentAi)
check('apply closes the review panel', reviewBar.hidden === true)
ed._onStateless(JSON.stringify({ event: 'ai-status', phase: 'review', entities: [{ quote: 'Alpha', type: 'Ort' }], roles: [] }))
ed.querySelector('.mce-ai-review-discard').click()
check('discard sends ai-discard and closes the panel',
  sentAi.some((m) => m.event === 'ai-discard') && reviewBar.hidden === true, sentAi)

// --- 16) image upload via the host-injected callback ------------------------------
let uploadedName = null
ed.uploadImage = async (file) => {
  uploadedName = file.name
  return 'https://repo.example/edu-sharing/eduservlet/download?nodeId=img-xyz'
}
ed.editor.commands.setContent('<p>Bildtest.</p>')
await ed._insertUploadedImage(new dom.window.File(['x'], 'foto.png', { type: 'image/png' }))
check('uploaded image lands in the doc with the returned repo url',
  uploadedName === 'foto.png'
  && ed.getMarkdown().includes('![foto.png](https://repo.example/edu-sharing/eduservlet/download?nodeId=img-xyz)'),
  ed.getMarkdown())

// --- 17) comments panel (host-injected node-comment API) --------------------------
const commentStore = [
  { id: 'c0', replyTo: null, text: 'Erster Kommentar', created: 1000, author: 'Jan', isOwn: true },
  { id: 'c1', replyTo: 'c0', text: 'Eine Antwort', created: 2000, author: 'Anna', isOwn: false },
]
const apiCalls = []
ed.commentsApi = {
  list: async () => commentStore,
  add: async (text, replyTo) => apiCalls.push({ op: 'add', text, replyTo }),
  remove: async (id) => apiCalls.push({ op: 'remove', id }),
}
const cBtn = ed.querySelector('.mce-comments-btn')
check('comments button appears once the host provides an API', Boolean(cBtn))
cBtn.click()
await new Promise((r) => setTimeout(r, 30))
const cPanel = ed.querySelector('.mce-comments')
check('comments panel opens and lists both comments',
  cPanel && !cPanel.hidden && ed.querySelectorAll('.mce-comment').length === 2)
check('replies are visually nested under their parent',
  ed.querySelectorAll('.mce-comment-reply').length === 1)
check('delete appears only on own comments',
  ed.querySelectorAll('.mce-comment-del').length === 1)
// answer a top-level comment
ed.querySelector('.mce-comment-replybtn').click()
ed.querySelector('.mce-comments-input').value = 'Meine Antwort'
ed.querySelector('.mce-comments-send').click()
await new Promise((r) => setTimeout(r, 30))
check('sending in reply mode passes the parent id',
  apiCalls.some((c) => c.op === 'add' && c.text === 'Meine Antwort' && c.replyTo === 'c0'), apiCalls)
// a comment with an active text selection carries the quote as an anchor
ed.editor.commands.setTextSelection({ from: 1, to: 9 })
ed.querySelector('.mce-comments-input').value = 'Zur Stelle'
ed.querySelector('.mce-comments-send').click()
await new Promise((r) => setTimeout(r, 30))
check('selection is attached as a »quote« anchor',
  apiCalls.some((c) => c.op === 'add' && /^»Bildtest« Zur Stelle$/.test(c.text)), apiCalls)
// delete own comment
ed.querySelector('.mce-comment-del').click()
await new Promise((r) => setTimeout(r, 30))
check('delete calls the api with the comment id',
  apiCalls.some((c) => c.op === 'remove' && c.id === 'c0'), apiCalls)
ed.querySelector('.mce-comments-close').click()
check('panel closes via ✕', cPanel.hidden === true)
// the host sets commentsApi BEFORE mounting (real host order) — the button
// must still become visible
const ed2 = document.createElement('md-collab-editor')
ed2.setAttribute('document-name', 'pre-mount')
ed2.setAttribute('websocket-url', 'ws://localhost:9/collab')
ed2.commentsApi = { list: async () => [], add: async () => {}, remove: async () => {} }
document.body.appendChild(ed2)
check('comments button visible when the API was injected before mount',
  ed2.querySelector('.mce-comments-btn').style.display !== 'none')
ed2.remove()

// --- 17b) in-text comment marks: »quote« anchors decorate the passage --------------
ed.editor.commands.setContent('<p>Bildtest steht hier. Noch ein Satz.</p>')
commentStore.push({ id: 'c2', replyTo: null, text: '»Bildtest« Passt der Begriff?', created: 3000, author: 'Anna', isOwn: false })
await ed._comments.preload()
let marks = ed.editor.view.dom.querySelectorAll('.mce-comment-mark')
check('anchored comment decorates its passage in the text',
  marks.length === 1 && marks[0].textContent === 'Bildtest', marks.length)
check('comments WITHOUT a quote anchor produce no mark',
  ed._comments.anchoredQuotes().length === 1, ed._comments.anchoredQuotes())
await ed._comments.openAt('c2')
const flashed = [...ed.querySelectorAll('.mce-comments [data-comment-id]')]
  .find((el) => el.dataset.commentId === 'c2')
check('mark click target: openAt opens the panel at the comment (highlighted)',
  !ed.querySelector('.mce-comments').hidden && flashed?.classList.contains('mce-comment-flash'),
  flashed?.className)
ed.querySelector('.mce-comments-close').click()
commentStore.pop()
await ed._comments.preload()
check('mark disappears when the anchored comment is gone',
  ed.editor.view.dom.querySelectorAll('.mce-comment-mark').length === 0)

// --- 17b2) media panel: the 🖼 button is the SINGLE image entry point ---------------
// Fallback cascade: mediaApi → panel · uploadImage only → file picker ·
// neither → URL prompt (plain toolbar behavior)
const imgToolBtn = [...ed.querySelectorAll('.mce-toolbar button')].find((b) => b.dataset.cmd === 'image')
check('upload-only (no mediaApi yet): 🖼 tooltip says upload',
  imgToolBtn?.title === 'Bild hochladen', imgToolBtn?.title)
ed.editor.commands.setContent('<p>Medientest.</p>')
ed.editor.chain().setImage({ src: 'https://repo/edu-sharing/eduservlet/download?nodeId=img-used', alt: 'x' }).run()
const mediaCalls = []
ed.mediaApi = {
  list: async () => [
    { imageId: 'img-used', name: 'mdimg-eins.png', url: 'https://repo/edu-sharing/eduservlet/download?nodeId=img-used' },
    { imageId: 'img-free', name: 'mdimg-zwei.png', url: 'https://repo/edu-sharing/eduservlet/download?nodeId=img-free' },
  ],
  remove: async (id) => mediaCalls.push(id),
}
check('with mediaApi: NO separate media button, 🖼 tooltip switches to manage wording',
  !ed.querySelector('.mce-media-btn') && imgToolBtn.title === 'Bilder einfügen & verwalten',
  imgToolBtn?.title)
imgToolBtn.click()
await new Promise((r) => setTimeout(r, 30))
const mPanel = ed.querySelector('.mce-media')
const mItems = [...ed.querySelectorAll('.mce-media-item')]
check('🖼 opens the media panel listing the editor images with thumbnails',
  mPanel && !mPanel.hidden && mItems.length === 2
  && mPanel.querySelectorAll('.mce-media-item img').length === 2, mItems.length)
check('image referenced in the text is flagged, unreferenced is not',
  mItems[0]?.querySelector('.mce-media-used') && !mItems[1]?.querySelector('.mce-media-used'),
  mPanel?.textContent)
mItems[1].querySelector('.mce-media-insert').click()
check('insert button embeds the stored image into the document',
  ed.getMarkdown().includes('nodeId=img-free'), ed.getMarkdown())
mItems[1].querySelector('.mce-media-del').click()
await new Promise((r) => setTimeout(r, 30))
check('delete calls the media api with the image id (confirmed)',
  mediaCalls.includes('img-free'), mediaCalls)
check('panel head offers UPLOAD (uploadImage is set)',
  Boolean(ed.querySelector('.mce-media-upload')))
ed.querySelector('.mce-media-upload').click()
check('panel upload button opens the file picker', Boolean(ed._imageInput))
dom.window.prompt = () => 'https://extern.example/url-bild.png'
ed.querySelector('.mce-media-url').click()
check('panel URL button inserts an image by URL',
  ed.getMarkdown().includes('https://extern.example/url-bild.png'), ed.getMarkdown())
ed.querySelector('.mce-media-close').click()
check('media panel closes via ✕', mPanel.hidden === true)

// Toolbar clusters: tagging (🏷 ¶ 🤖) → document tools (🔍 ☰ 📇) →
// panel (💬) → export (⬇ 🖨)
const barChildren = [...ed.querySelector('.mce-toolbar').children]
const pos = (sel) => barChildren.indexOf(ed.querySelector(sel))
check('toolbar order: tagging → tools → comments → export',
  pos('.mce-role-select') > -1
  && pos('.mce-ai-btn') < pos('.mce-find-btn')
  && pos('.mce-find-btn') < pos('.mce-toc-btn')
  && pos('.mce-glossary-btn') < pos('.mce-comments-btn')
  && pos('.mce-comments-btn') < pos('.mce-export-md-btn')
  && pos('.mce-export-md-btn') < pos('.mce-print-btn'),
  barChildren.map((b) => b.className || b.tagName).join(','))

// --- 17b3) image sizing: contextual S/M/L/⛶ buttons on a selected image ------------
ed.editor.commands.setContent('<p>Davor.</p>')
const sizeBtns = ['imgS', 'imgM', 'imgL', 'imgFull']
  .map((cmd) => [...ed.querySelectorAll('.mce-toolbar button')].find((b) => b.dataset.cmd === cmd))
check('image size buttons exist', sizeBtns.every(Boolean))
check('size buttons are hidden while no image is selected',
  sizeBtns.every((b) => b.style.display === 'none'))
ed.editor.chain().setImage({ src: 'https://repo/x.png', alt: 'G' }).run()
let imgPos = null
ed.editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image') imgPos = pos })
ed.editor.commands.setNodeSelection(imgPos)
ed._updateToolbar()
check('size buttons appear when an image is selected',
  sizeBtns.every((b) => b.style.display === ''))
sizeBtns[1].click() // M
check('M sets a width that persists as inline-HTML img',
  /<img src="https:\/\/repo\/x\.png" alt="G" width="480">/.test(ed.getMarkdown()), ed.getMarkdown())
ed.editor.commands.setNodeSelection(imgPos)
sizeBtns[3].click() // ⛶ back to natural size
check('⛶ removes the width — image is pure markdown again',
  ed.getMarkdown().includes('![G](https://repo/x.png)'), ed.getMarkdown())

// --- 17b4) B-1: width survives the LOAD path as a number (active state) ------------
// parseHTML delivers attributes as strings — without normalization a loaded
// "480" never matches the buttons' numeric 480 (no active mark, and re-
// clicking the same size would dirty the document for nothing)
ed.editor.commands.setContent('<p>Reload.</p><img src="https://repo/y.png" alt="r" width="480">')
let imgPos2 = null
ed.editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image') imgPos2 = pos })
ed.editor.commands.setNodeSelection(imgPos2)
ed._updateToolbar()
const mBtn480 = [...ed.querySelectorAll('.mce-toolbar button')].find((b) => b.dataset.cmd === 'imgM')
check('loaded sized image marks its size button active (B-1)',
  mBtn480.classList.contains('mce-active'),
  JSON.stringify(ed.editor.getAttributes('image')))

// --- 17b5) B-2: media panel head actions respect editability ------------------------
ed.setAttribute('read-only', 'true')
const imgToolBtn2 = [...ed.querySelectorAll('.mce-toolbar button')].find((b) => b.dataset.cmd === 'image')
imgToolBtn2.click() // opens the media panel (mediaApi is set)
await new Promise((r) => setTimeout(r, 30))
check('read-only: upload and URL buttons in the panel head are disabled (B-2)',
  ed.querySelector('.mce-media-upload')?.disabled === true
  && ed.querySelector('.mce-media-url')?.disabled === true)
ed.querySelector('.mce-media-close').click()
ed.setAttribute('read-only', 'false')

// --- 17c) export: markdown download + print view -----------------------------------
ed.editor.commands.setContent('<h1>Mein Titel</h1><p>Inhalt des Textes.</p>')
const mdBtn = ed.querySelector('.mce-export-md-btn')
const printBtn = ed.querySelector('.mce-print-btn')
check('export buttons exist in the toolbar', Boolean(mdBtn) && Boolean(printBtn))
let capturedBlob = null
let download = null
const origCreateUrl = globalThis.URL.createObjectURL
const origRevokeUrl = globalThis.URL.revokeObjectURL
globalThis.URL.createObjectURL = (blob) => { capturedBlob = blob; return 'blob:test' }
globalThis.URL.revokeObjectURL = () => {}
dom.window.HTMLAnchorElement.prototype.click = function () {
  download = { href: this.getAttribute('href'), download: this.download }
}
mdBtn.click()
check('markdown download is named after the node id (document-name attribute)',
  download?.download === 'test-node.md' && download?.href === 'blob:test', download)
check('downloaded blob contains the WHOLE document markdown',
  Boolean(capturedBlob) && (await capturedBlob.text()).includes('# Mein Titel')
  && (await capturedBlob.text()).includes('Inhalt des Textes.'), await capturedBlob?.text())
globalThis.URL.createObjectURL = origCreateUrl
globalThis.URL.revokeObjectURL = origRevokeUrl
// Print must NOT rely on window.print() of the app page (embedded webviews
// have no print preview there) — it opens a dedicated window with the content
let printWin = null
dom.window.open = () => {
  printWin = {
    written: '',
    document: { write: (s) => { printWin.written += s }, close: () => {}, readyState: 'complete' },
    focus: () => {}, printed: false, print: () => { printWin.printed = true },
    addEventListener: () => {},
  }
  return printWin
}
printBtn.click()
check('print opens a dedicated window with the document content',
  printWin && printWin.written.includes('Inhalt des Textes.') && printWin.printed,
  printWin?.written?.slice(0, 100))
check('print window carries no app chrome (no toolbar markup)',
  printWin && !printWin.written.includes('mce-toolbar'))
let fallbackPrinted = false
dom.window.open = () => null // popup blocked
dom.window.print = () => { fallbackPrinted = true }
printBtn.click()
check('popup blocked → falls back to window.print (page print CSS)', fallbackPrinted)

// --- 18) teardown ------------------------------------------------------------------
ed.remove()
check('disconnect: component destroys the editor', ed.editor.isDestroyed === true)

process.exit(fail ? 1 : 0)
