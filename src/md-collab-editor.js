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
 *                                     | 'session-expired' (token rejected — sign in again)
 *     users-change      {users: [{name, color, isSelf, active}]}
 *     save-state-change {dirty, saving, lastSavedAt, autosave, canPersist, error, …}
 *     synced            {}          — initial server synchronization finished
 *
 *   Methods:
 *     getMarkdown(): string
 *     getAnnotations(): [{id, quote, occurrence, type, entityId, start, end}]
 *                       — standoff annotations, offsets resolved against the
 *                         editor's plain text (start/end null = quote not found)
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
import { SaveBarUi } from './save-bar.js'
import { TOOLBAR } from './toolbar.js'
import { AnnotationDecorations } from './annotation-extension.js'
import { AnnotationController } from './annotation-controller.js'
import { PresenceTracker } from './presence.js'
import { RoleUi } from './role-ui.js'
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
      <div class="mce-roles" part="roles" role="list" aria-label="${t(this._lang, 'editor.rolesLabel')}" style="display:none"></div>
      <div class="mce-entities" part="entities" role="list" aria-label="${t(this._lang, 'editor.entitiesLabel')}" style="display:none"></div>
      <div class="mce-editor" part="editor"></div>
    `
    this._rolesEl = this.querySelector('.mce-roles')
    this._entitiesEl = this.querySelector('.mce-entities')
    // Presence display belongs to the component (the host page is not
    // visible in the target embedding): chips of connected users, toolbar right
    this._usersEl = document.createElement('span')
    this._usersEl.className = 'mce-users'
    this._usersEl.setAttribute('part', 'users')

    // Save bar (LED + countdown + "Speichern" button) — state, DOM and server
    // events live in the controller (src/save-bar.js)
    this._saveBar = new SaveBarUi({
      getLang: () => this._lang,
      sendSave: () => this.provider.sendStateless(JSON.stringify({ event: 'save' })),
      onStateChange: (state) => this._emit('save-state-change', state),
    })

    this.provider = new HocuspocusProvider({
      url: wsUrl,
      name: documentName,
      token: token || 'anonymous',
      onStatus: ({ status }) => this._emit('status-change', { status }),
      // The server REJECTS presented-but-invalid tokens (expired 8 h session,
      // logout on another tab/device). Stop the provider's reconnect loop —
      // every retry would be rejected again — and tell the host WHY, instead
      // of showing a bare "disconnected" (audit UX-1).
      onAuthenticationFailed: () => {
        this.provider.disconnect()
        this._emit('status-change', { status: 'session-expired' })
      },
      onSynced: () => {
        this._saveBar.markSynced()
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
      getLocked: () => this._plainKeywords || [],
      onChange: () => this._onAnnotationsChanged(),
    })

    // Paragraph-role UI (select + amber chips bar) — src/role-ui.js
    this._roles = new RoleUi({
      rolesEl: this._rolesEl,
      getEditor: () => this.editor,
      getLang: () => this._lang,
    })

    // Presence: awareness tracking + chips live in src/presence.js (F-T5);
    // the component only re-emits the user list as its public event
    this._presence = new PresenceTracker({
      provider: this.provider,
      usersEl: this._usersEl,
      getLang: () => this._lang,
      onUsers: (users) => this._emit('users-change', { users }),
    })

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
        this._roles.renderChips() // roles live in the doc → refresh on every change
        // Track changes (own AND remote) for the save countdown
        this._saveBar.noteChange()
      },
      onCreate: () => this._emit('editor-ready', { editor: this.editor }),
    })

    this._renderToolbar()
    this._tags.renderChips()
    this._roles.renderChips()

    // Warn on leave if unsaved changes would be lost (autosave off — with
    // autosave on the server itself saves on the last disconnect)
    this._beforeUnload = (e) => {
      const s = this._saveBar.state
      if (s.dirty && !s.autosave && s.canPersist) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', this._beforeUnload)
  }

  disconnectedCallback() {
    this._presence?.dispose()
    this._saveBar?.dispose()
    clearTimeout(this._mdTimer)
    clearTimeout(this._aiStatusTimer)
    this._tags?.dispose()
    window.removeEventListener('beforeunload', this._beforeUnload)
    this.editor?.destroy()
    this.provider?.destroy()
    this._initialized = false
  }

  attributeChangedCallback(name, _old, value) {
    if (!this.editor) return
    if (name === 'read-only') {
      // Suppress TipTap's update emit — it would mark the doc dirty without a
      // document change (audit 7, N-2); refresh the affected UI explicitly
      this.editor.setEditable(value !== 'true', false)
      this._updateToolbar()
      this._roles.renderChips()
      this._tags.renderChips()
    }
    if (name === 'user-name') {
      this.editor.chain().updateUser({ name: value, color: this.getAttribute('user-color') }).run()
    }
  }

  // ------------------------------------------------------------- Public ---
  getMarkdown() {
    return this.editor ? htmlToMarkdown(this.editor.getHTML()) : ''
  }

  /** Standoff export: annotations with offsets resolved against the editor's
   * PLAIN text (the anchor text of pills/decorations) — not the markdown
   * source, whose formatting marks/escaping would report false orphans. */
  getAnnotations() {
    return this._tags ? this._tags.resolvedList() : []
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
      btn.innerHTML = tool.labelKey ? t(this._lang, tool.labelKey) : tool.label
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

    // Paragraph-role control (the SECOND tagging system, src/role-ui.js):
    // a single exclusive choice per block → a <select>, distinct from the
    // multi-toggle entity tagging. Roles are structure, never keywords.
    bar.appendChild(this._roles.buildSelect())

    // AI auto-tagging trigger — the actual AI lives entirely on the server
    // (server/ai-tagging.js); the button just sends the command and mirrors
    // the broadcast status. Hidden until the server reports aiAvailable.
    this._aiBtn = document.createElement('button')
    this._aiBtn.type = 'button'
    this._aiBtn.className = 'mce-ai-btn'
    this._aiBtn.innerHTML = t(this._lang, 'ai.buttonLabel')
    this._aiBtn.title = t(this._lang, 'ai.buttonTitle')
    this._aiBtn.setAttribute('aria-label', t(this._lang, 'ai.buttonTitle'))
    this._aiBtn.style.display = 'none'
    this._aiBtn.addEventListener('click', () => {
      this.provider.sendStateless(JSON.stringify({ event: 'ai-tag' }))
    })
    bar.appendChild(this._aiBtn)
    this._aiStatusEl = document.createElement('span')
    this._aiStatusEl.className = 'mce-ai-status'
    this._aiStatusEl.setAttribute('role', 'status')
    this._aiStatusEl.setAttribute('aria-live', 'polite')
    bar.appendChild(this._aiStatusEl)

    bar.appendChild(this._usersEl)
    bar.appendChild(this._saveBar.build())

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
    this._saveBar.render()
  }

  /** Server broadcasts: routes AI status + component extras here, save state
   * ('config'/'saved'/'save-error') to the save-bar controller. */
  _onStateless(payload) {
    let msg
    try { msg = JSON.parse(payload) } catch { return }
    if (msg.event === 'ai-status') {
      this._onAiStatus(msg)
      return // AI status does not touch the save state
    }
    if (msg.event === 'config') {
      // AI tagging button only appears when the server has a model configured
      if (this._aiBtn && msg.aiAvailable !== undefined) {
        this._aiBtn.style.display = msg.aiAvailable ? '' : 'none'
      }
      // Plain editorial keywords → locked chips in the entities bar
      if (msg.plainKeywords !== undefined) {
        this._plainKeywords = msg.plainKeywords
        this._tags.renderChips()
      }
    }
    this._saveBar.applyServerEvent(msg)
  }

  /** Mirror the server's AI-tagging status (codes → translated messages). */
  _onAiStatus(msg) {
    const set = (text, isError = false) => {
      this._aiStatusEl.textContent = text
      this._aiStatusEl.classList.toggle('mce-ai-error', isError)
      clearTimeout(this._aiStatusTimer)
      if (text && msg.phase !== 'started') {
        this._aiStatusTimer = setTimeout(() => { this._aiStatusEl.textContent = '' }, 8000)
      }
    }
    if (msg.phase === 'started') {
      this._aiBtn.disabled = true
      this._aiBtn.classList.add('mce-ai-running')
      set(t(this._lang, 'ai.running'))
      return
    }
    this._aiBtn.disabled = false
    this._aiBtn.classList.remove('mce-ai-running')
    if (msg.phase === 'done') {
      set(t(this._lang, 'ai.done', { entities: msg.entities ?? 0, roles: msg.roles ?? 0 }))
    } else if (msg.phase === 'error') {
      if (msg.code === 'cooldown') {
        set(t(this._lang, 'ai.errorCooldown', { secs: msg.retryInSec ?? '?' }), true)
        return
      }
      const key = { busy: 'ai.errorBusy', 'no-write': 'ai.errorNoWrite', 'not-configured': 'ai.errorNotConfigured' }[msg.code]
      set(key ? t(this._lang, key) : t(this._lang, 'ai.errorUpstream', { detail: msg.detail || msg.code || '?' }), true)
    }
  }

  // ------------------------------------------------------- Annotations ---
  /** Controller callback: annotations changed → public event + dirty state. */
  _onAnnotationsChanged() {
    this._emit('annotations-change', { annotations: this.getAnnotations() })
    // Tag changes are persisted like text changes (keywords) → save countdown
    this._saveBar.noteChange()
  }

  _updateToolbar() {
    if (!this._buttons || !this.editor) return
    if (this._tagBtn) {
      this._tagBtn.disabled = !this.editor.isEditable || this.editor.state.selection.empty
    }
    this._roles.syncSelect()
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
