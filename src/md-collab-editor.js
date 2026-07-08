/**
 * <md-collab-editor> — collaborative markdown editor as a custom element.
 *
 * Framework-agnostic (usable in Angular via CUSTOM_ELEMENTS_SCHEMA). The
 * component knows NOTHING about edu-sharing: session handling, loading and
 * saving live with the host. Interface:
 *
 *   Attributes / properties (in):
 *     document-name   Room name in the Yjs network (usually the node ID). Required.
 *     websocket-url   Hocuspocus server (default: ws(s)://<host>/collab)
 *     user-name       Display name for cursor/presence
 *     user-color      Cursor color (default: random)
 *     token           Opaque auth token, passed through to the collab server
 *                     (validated there). Without a token the server switches
 *                     the connection to read-only.
 *     read-only       "true" → editor not editable (in addition to the server gate)
 *     lang            UI language: "de" (default) | "en". Only affects
 *                     displayed text (toolbar, dialogs, save bar) — the
 *                     default entity-type catalog VALUES persisted to
 *                     edu-sharing always stay German (see entity-types.js).
 *
 *   Events (out, CustomEvent with detail):
 *     editor-ready      {editor}
 *     markdown-change   {markdown}  — debounced (1s), current state as markdown
 *     status-change     {status}    — 'connecting' | 'connected' | 'disconnected'
 *     users-change      {users: [{name, color, isSelf, active}]}
 *     save-state-change {dirty, saving, lastSavedAt, autosave, canPersist, error, …}
 *     synced            {}          — initial server synchronization finished
 *
 *   Methods:
 *     getMarkdown(): string
 *     getAnnotations(): [{id, quote, occurrence, type, entityId, start, end}]
 *                       — standoff annotations, offsets resolved against the
 *                         current markdown (start/end null = quote not found)
 *     addAnnotation({quote, type, entityId?, occurrence?}): string|null
 *                       — programmatic tagging (e.g. AI results); returns an
 *                         error message or null on success
 *     focus()
 *
 *   Built-in UI (right side of the toolbar): presence chips of connected users
 *   and the save bar (LED, countdown until autosave, "Speichern" button). The
 *   save state is broadcast by the collab server and consistent for all clients.
 */
import { Editor } from '@tiptap/core'
import { Placeholder } from '@tiptap/extensions'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { createExtensions } from './extensions.js'
import { htmlToMarkdown } from './markdown.js'
import { computeSaveBar } from './save-state.js'
import { TOOLBAR } from './toolbar.js'
import { AnnotationDecorations } from './annotation-extension.js'
import { AnnotationController } from './annotation-controller.js'
import { t, setActiveLang, LANGS, DEFAULT_LANG } from './i18n.js'

// User colors for carets/presence chips — all chosen for ≥4.5:1 contrast
// with white label text (WCAG AA)
const COLORS = ['#b3261e', '#0b57d0', '#146c2e', '#9a4600', '#7b1fa2', '#00695c', '#ad1457', '#5d4037']

class MdCollabEditor extends HTMLElement {
  static get observedAttributes() {
    return ['read-only', 'user-name']
  }

  connectedCallback() {
    if (this._initialized) return
    this._initialized = true

    const documentName = this.getAttribute('document-name')
    // UI language for this instance ('de'|'en', default 'de') — also drives
    // toolbar.js's tooltips via the module-level active language (setActiveLang)
    this._lang = LANGS.includes(this.getAttribute('lang')) ? this.getAttribute('lang') : DEFAULT_LANG
    setActiveLang(this._lang)
    if (!documentName) {
      this.innerHTML = `<p style="color:#c00">${t(this._lang, 'editor.missingDocumentName')}</p>`
      return
    }
    const defaultWs = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`
    const wsUrl = this.getAttribute('websocket-url') || defaultWs
    const userName = this.getAttribute('user-name') || t(this._lang, 'host.anonymousName')
    const userColor = this.getAttribute('user-color') || COLORS[Math.floor(Math.random() * COLORS.length)]
    const token = this.getAttribute('token') || ''
    const readOnly = this.getAttribute('read-only') === 'true'

    this.classList.add('mce-root')
    this.innerHTML = `
      <div class="mce-toolbar" part="toolbar" role="toolbar" aria-label="${t(this._lang, 'editor.toolbarLabel')}"></div>
      <div class="mce-entities" part="entities" role="list" aria-label="${t(this._lang, 'editor.entitiesLabel')}" style="display:none"></div>
      <div class="mce-editor" part="editor"></div>
    `
    this._entitiesEl = this.querySelector('.mce-entities')
    // Presence display belongs to the component (the host page is not
    // visible in the target embedding): chips of connected users, toolbar right
    this._usersEl = document.createElement('span')
    this._usersEl.className = 'mce-users'
    this._usersEl.setAttribute('part', 'users')

    // Save bar: status LED + countdown/time + "Speichern" button
    this._saveBarEl = document.createElement('span')
    this._saveBarEl.className = 'mce-savebar'
    this._saveBarEl.setAttribute('part', 'savebar')
    this._saveBarEl.innerHTML = `
      <span class="mce-save-dot" data-state="idle" aria-hidden="true"></span>
      <span class="mce-save-text" role="status" aria-live="polite">–</span>
      <button type="button" class="mce-save-btn" disabled>${t(this._lang, 'editor.saveButton')}</button>
    `
    this._saveBarEl.querySelector('.mce-save-btn').addEventListener('click', () => {
      if (!this._save.dirty || this._save.saving) return
      this._save.saving = true
      this._renderSaveBar()
      this.provider.sendStateless(JSON.stringify({ event: 'save' }))
      // Safety net: if the server never answers (connection drop), don't leave
      // the button stuck on "Speichere …" forever (audit L-01)
      clearTimeout(this._saveTimeout)
      this._saveTimeout = setTimeout(() => {
        if (this._save.saving) {
          this._save.saving = false
          this._save.error = t(this._lang, 'editor.saveTimeoutError')
          this._renderSaveBar()
        }
      }, 20000)
    })

    // Save state: dirty/lastChange observed locally (every client sees all
    // Yjs changes), save results arrive as broadcasts from the server
    this._save = {
      dirty: false, dirtySince: 0, lastChange: 0,
      lastSavedAt: null, saving: false, error: null,
      autosave: true, debounce: 15000, maxDebounce: 90000,
      canPersist: false, synced: false,
    }

    this.provider = new HocuspocusProvider({
      url: wsUrl,
      name: documentName,
      token: token || 'anonymous',
      onStatus: ({ status }) => this._emit('status-change', { status }),
      onSynced: () => {
        this._save.synced = true
        // Ask the server for the save state (answered by a config broadcast)
        this.provider.sendStateless(JSON.stringify({ event: 'hello' }))
        this._emit('synced', {})
      },
      onStateless: ({ payload }) => this._onStateless(payload),
    })

    // Standoff annotations: shared Y.Array in the SAME Yjs document as the
    // text — tags and text synchronize over one channel and are seeded/
    // persisted together by the server (general keywords "Name (Typ)").
    // Feature logic lives in the controller (src/annotation-controller.js).
    this._tags = new AnnotationController({
      root: this,
      entitiesEl: this._entitiesEl,
      annotations: this.provider.document.getArray('annotations'),
      getEditor: () => this.editor,
      getLang: () => this._lang,
      onChange: () => this._onAnnotationsChanged(),
    })

    // Activity tracking: while a user's cursor is moving, they count as
    // "active" (typing/selecting) for 4 seconds
    this._awCursors = new Map() // clientId → serialized cursor position
    this._awActive = new Map()  // clientId → timestamp of last activity
    this._awStates = []
    this.provider.on('awarenessUpdate', ({ states }) => {
      const now = Date.now()
      for (const s of states) {
        if (!s.user) continue
        const cur = JSON.stringify(s.cursor ?? null)
        const prev = this._awCursors.get(s.clientId)
        if (prev !== undefined && prev !== cur) this._awActive.set(s.clientId, now)
        this._awCursors.set(s.clientId, cur)
      }
      this._awStates = states
      this._emitUsers()
    })
    // Activity fades out — re-emit periodically
    this._usersInterval = setInterval(() => this._emitUsers(), 2000)

    this.editor = new Editor({
      element: this.querySelector('.mce-editor'),
      editable: !readOnly,
      extensions: [
        ...createExtensions(),
        Placeholder.configure({ placeholder: t(this._lang, 'editor.placeholder') }),
        AnnotationDecorations.configure({
          getAnnotations: () => this._tags.raw(),
          onAnnotationClick: (hits, event) => this._tags.handleClick(hits, event),
        }),
        Collaboration.configure({ document: this.provider.document }),
        CollaborationCaret.configure({
          provider: this.provider,
          user: { name: userName, color: userColor },
        }),
      ],
      onTransaction: () => this._updateToolbar(),
      onUpdate: () => {
        this._scheduleMarkdownEmit()
        // Track changes (own AND remote) for the save countdown — but only
        // after the initial sync, otherwise preloading would count as a change
        if (this._save.synced) {
          const now = Date.now()
          if (!this._save.dirty) this._save.dirtySince = now
          this._save.dirty = true
          this._save.lastChange = now
          this._renderSaveBar()
        }
      },
      onCreate: () => this._emit('editor-ready', { editor: this.editor }),
    })

    this._renderToolbar()
    this._tags.renderChips()
    this._saveTicker = setInterval(() => this._renderSaveBar(), 1000)

    // Warn on leave if unsaved changes would be lost (autosave off — with
    // autosave on the server itself saves on the last disconnect)
    this._beforeUnload = (e) => {
      if (this._save.dirty && !this._save.autosave && this._save.canPersist) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', this._beforeUnload)
  }

  disconnectedCallback() {
    clearInterval(this._usersInterval)
    clearInterval(this._saveTicker)
    clearTimeout(this._mdTimer)
    clearTimeout(this._saveTimeout)
    this._tags?.dispose()
    window.removeEventListener('beforeunload', this._beforeUnload)
    this.editor?.destroy()
    this.provider?.destroy()
    this._initialized = false
  }

  attributeChangedCallback(name, _old, value) {
    if (!this.editor) return
    if (name === 'read-only') this.editor.setEditable(value !== 'true')
    if (name === 'user-name') {
      this.editor.chain().updateUser({ name: value, color: this.getAttribute('user-color') }).run()
    }
  }

  // ------------------------------------------------------------- Public ---
  getMarkdown() {
    return this.editor ? htmlToMarkdown(this.editor.getHTML()) : ''
  }

  /** Standoff export: annotations with offsets resolved against the markdown. */
  getAnnotations() {
    return this._tags ? this._tags.list(this.getMarkdown()) : []
  }

  /** Programmatic tagging (AI entry point) — error message or null. */
  addAnnotation(annotation) {
    return this._tags ? this._tags.add(annotation) : t(this._lang, 'editor.notInitialized')
  }

  focus() {
    this.editor?.chain().focus().run()
  }

  // ----------------------------------------------------------- Internal ---
  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }))
  }

  _emitUsers() {
    const now = Date.now()
    const self = this.provider?.document?.clientID
    const users = this._awStates
      .filter((s) => s.user)
      .map((s) => ({
        name: s.user.name,
        color: s.user.color,
        isSelf: s.clientId === self,
        active: now - (this._awActive.get(s.clientId) || 0) < 4000,
      }))
    this._renderUsers(users)
    this._emit('users-change', { users })
  }

  _scheduleMarkdownEmit() {
    clearTimeout(this._mdTimer)
    this._mdTimer = setTimeout(() => {
      this._emit('markdown-change', { markdown: this.getMarkdown() })
      this._tags.renderChips() // text edits can orphan/revive quotes → refresh chips
    }, 1000)
  }

  _renderToolbar() {
    const bar = this.querySelector('.mce-toolbar')
    this._buttons = []
    for (const tool of TOOLBAR) {
      if (tool.sep) {
        const sep = document.createElement('span')
        sep.className = 'mce-sep'
        bar.appendChild(sep)
        continue
      }
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.innerHTML = tool.label
      const title = t(this._lang, tool.titleKey)
      btn.title = title
      btn.setAttribute('aria-label', title)
      if (tool.active) btn.setAttribute('aria-pressed', 'false')
      btn.dataset.cmd = tool.cmd
      if (tool.table) btn.dataset.table = 'true'
      btn.addEventListener('click', () => tool.run(this.editor))
      bar.appendChild(btn)
      this._buttons.push({ btn, tool })
    }

    // Semantic tagging needs component context (popup, Y.Array) — the button
    // therefore lives here instead of in the static TOOLBAR definition
    const sep = document.createElement('span')
    sep.className = 'mce-sep'
    bar.appendChild(sep)
    this._tagBtn = document.createElement('button')
    this._tagBtn.type = 'button'
    this._tagBtn.innerHTML = t(this._lang, 'editor.tagButtonLabel')
    this._tagBtn.title = t(this._lang, 'editor.tagButtonTitle')
    this._tagBtn.setAttribute('aria-label', t(this._lang, 'editor.tagButtonTitle'))
    this._tagBtn.disabled = true
    this._tagBtn.addEventListener('click', () => this._tags.openTagDialog())
    bar.appendChild(this._tagBtn)

    bar.appendChild(this._usersEl)
    bar.appendChild(this._saveBarEl)

    // WAI-ARIA toolbar pattern: one tab stop, arrow keys move between buttons
    const rovingButtons = () =>
      [...bar.querySelectorAll('button')].filter((b) => b.style.display !== 'none' && !b.disabled)
    const setRoving = (target) => {
      for (const b of bar.querySelectorAll('button')) b.tabIndex = -1
      target.tabIndex = 0
    }
    setRoving(this._buttons[0].btn)
    bar.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return
      const btns = rovingButtons()
      const i = btns.indexOf(document.activeElement)
      if (i === -1) return
      e.preventDefault()
      const n = e.key === 'ArrowRight' ? (i + 1) % btns.length
        : e.key === 'ArrowLeft' ? (i - 1 + btns.length) % btns.length
        : e.key === 'Home' ? 0 : btns.length - 1
      setRoving(btns[n])
      btns[n].focus()
    })
    // Clicking a button makes it the tab stop
    bar.addEventListener('focusin', (e) => {
      if (e.target.matches('button')) setRoving(e.target)
    })

    this._updateToolbar()
    this._renderSaveBar()
  }

  /** Server broadcasts: save results + configuration (consistent for all clients). */
  _onStateless(payload) {
    let msg
    try { msg = JSON.parse(payload) } catch { return }
    const s = this._save
    if (msg.event === 'config') {
      s.debounce = msg.saveDebounceMs ?? s.debounce
      s.maxDebounce = msg.saveMaxDebounceMs ?? s.maxDebounce
      s.autosave = msg.autosave ?? s.autosave
      s.canPersist = msg.canPersist ?? s.canPersist
      s.lastSavedAt = msg.lastSavedAt ?? s.lastSavedAt
      if (msg.dirty && !s.dirty) { s.dirty = true; s.dirtySince = Date.now(); s.lastChange = Date.now() }
      if (msg.dirty === false) s.dirty = false
    } else if (msg.event === 'saved') {
      clearTimeout(this._saveTimeout)
      s.dirty = false
      s.saving = false
      s.error = null
      if (msg.at) s.lastSavedAt = msg.at
    } else if (msg.event === 'save-error') {
      clearTimeout(this._saveTimeout)
      s.saving = false
      s.error = msg.message || t(this._lang, 'editor.saveFailedFallback')
    }
    this._renderSaveBar()
    this._emit('save-state-change', { ...s })
  }

  _renderSaveBar() {
    if (!this._saveBarEl) return
    const { state, label, title, canSaveNow } = computeSaveBar(this._save, Date.now(), this._lang)
    this._saveBarEl.querySelector('.mce-save-dot').dataset.state = state
    const text = this._saveBarEl.querySelector('.mce-save-text')
    text.textContent = label
    text.title = title
    this._saveBarEl.querySelector('.mce-save-btn').disabled = !canSaveNow
  }

  _renderUsers(users) {
    if (!this._usersEl) return
    this._usersEl.innerHTML = ''
    for (const u of users) {
      const chip = document.createElement('span')
      chip.className = 'mce-chip' + (u.active ? ' mce-chip-active' : '')
      chip.style.background = u.color || '#888'
      chip.textContent = (u.name || '?') + (u.isSelf ? t(this._lang, 'users.self') : '') + (u.active && !u.isSelf ? ' ✎' : '')
      chip.title = u.active ? t(this._lang, 'users.editingTitle', { name: u.name }) : t(this._lang, 'users.connectedTitle', { name: u.name })
      this._usersEl.appendChild(chip)
    }
  }

  // ------------------------------------------------------- Annotations ---
  /** Controller callback: annotations changed → public event + dirty state. */
  _onAnnotationsChanged() {
    this._emit('annotations-change', { annotations: this.getAnnotations() })
    // Tag changes are persisted like text changes (keywords) → save countdown
    if (this._save.synced) {
      const now = Date.now()
      if (!this._save.dirty) this._save.dirtySince = now
      this._save.dirty = true
      this._save.lastChange = now
      this._renderSaveBar()
    }
  }

  _updateToolbar() {
    if (!this._buttons || !this.editor) return
    if (this._tagBtn) {
      this._tagBtn.disabled = !this.editor.isEditable || this.editor.state.selection.empty
    }
    const inTable = this.editor.isActive('table')
    for (const { btn, tool } of this._buttons) {
      if (tool.active) {
        const on = tool.active(this.editor)
        btn.classList.toggle('mce-active', on)
        btn.setAttribute('aria-pressed', String(on))
      }
      if (tool.table) btn.style.display = inTable ? '' : 'none'
    }
  }
}

customElements.define('md-collab-editor', MdCollabEditor)
