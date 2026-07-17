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
 *     viewer          "true" → read view without the toolbar (externally
 *                     toggleable at runtime, e.g. by the embedding page)
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
 *   Properties (in, host-injected — keep the component repository-agnostic):
 *     uploadImage      async (File) => url — replaces the image-URL prompt
 *                      with a file picker; the host uploads (e.g. as an
 *                      edu-sharing child-IO) and returns the embed URL
 *     commentsApi      {list(), add(text, replyTo), remove(id)} — enables the
 *                      💬 node-comment panel (right-edge slide-in); comments
 *                      with a »quote« anchor also mark their passage in-text
 *     mediaApi         {list(), remove(imageId)} — enables the 🗂 media panel
 *                      (uploaded editor images: thumbnails, re-insert, delete)
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
import { htmlToMarkdown } from './markdown.js'
import { setupComponent } from './component-setup.js'
import { buildToolbar } from './toolbar-setup.js'
import { findHeadingBySlug, collectHeadings } from './toc.js'
import { buildTextIndex } from './annotation-extension.js'
import { ySyncPluginKey, relativePositionToAbsolutePosition } from 'y-prosemirror'
import { createRelativePositionFromJSON } from 'yjs'
import { t, setActiveLang, LANGS, DEFAULT_LANG } from './i18n.js'

// User colors for carets/presence chips — all chosen for ≥4.5:1 contrast
// with white label text (WCAG AA)
const COLORS = ['#b3261e', '#0b57d0', '#146c2e', '#9a4600', '#7b1fa2', '#00695c', '#ad1457', '#5d4037']

class MdCollabEditor extends HTMLElement {
  static get observedAttributes() {
    return ['read-only', 'user-name', 'viewer']
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
      <div class="mce-find" part="find" role="search" hidden></div>
      <div class="mce-ai-review" part="ai-review" hidden></div>
      <div class="mce-comments" part="comments" hidden></div>
      <div class="mce-media" part="media" hidden></div>
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

    // Controllers, provider, editor and all wiring — src/component-setup.js
    setupComponent(this, { wsUrl, documentName, token, userName, userColor, readOnly })

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
    if (name === 'read-only' || name === 'viewer') this._applyMode()
    if (name === 'user-name') {
      this.editor.chain().updateUser({ name: value, color: this.getAttribute('user-color') }).run()
    }
  }

  /** Apply the read-only/viewer attributes: viewer = read view without the
   * toolbar (externally controlled), read-only = non-editable with toolbar. */
  _applyMode() {
    const viewer = this.getAttribute('viewer') === 'true'
    const readOnly = this.getAttribute('read-only') === 'true'
    this.classList.toggle('mce-viewer', viewer)
    const bar = this.querySelector('.mce-toolbar')
    if (bar) bar.hidden = viewer
    // Suppress TipTap's update emit — a mode switch is not a document change
    // and must not mark the doc dirty (audit 7, N-2); refresh UI explicitly
    this.editor.setEditable(!viewer && !readOnly, false)
    this._updateToolbar()
    this._roles.renderChips()
    this._tags.renderChips()
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

  /** Host-injected comment API {list, add(text, replyTo), remove(id)} —
   * setting it reveals the 💬 button (see src/comments-ui.js). */
  set commentsApi(api) {
    this._commentsApi = api || null
    if (this._comments?.button) this._comments.button.style.display = api ? '' : 'none'
    // Feed the in-text comment marks without waiting for the panel to open
    if (api && this._comments && this.editor) this._comments.preload()
  }

  get commentsApi() {
    return this._commentsApi || null
  }

  /** Host-injected upload callback async (File) => url. As an accessor so
   * post-mount injection also updates the 🖼 tooltip. */
  set uploadImage(fn) {
    this._uploadImage = fn || null
    this._syncImageButton()
  }

  get uploadImage() {
    return this._uploadImage || null
  }

  /** Host-injected media API {list, remove(imageId)} — the 🖼 button then
   * opens the media panel (upload ⬆ / URL 🔗 / manage, src/media-ui.js)
   * instead of acting directly. */
  set mediaApi(api) {
    this._mediaApi = api || null
    this._syncImageButton()
  }

  get mediaApi() {
    return this._mediaApi || null
  }

  /** 🖼 is the single image entry point — its tooltip mirrors the injected
   * capabilities (media panel > upload picker > URL prompt). */
  _syncImageButton() {
    const btn = this.querySelector('.mce-toolbar button[data-cmd="image"]')
    if (!btn) return
    const key = this._mediaApi ? 'toolbar.imageMedia'
      : this._uploadImage ? 'toolbar.imageUpload' : 'toolbar.image'
    const title = t(this._lang, key)
    btn.title = title
    btn.setAttribute('aria-label', title)
  }

  /** File picker for the image upload path (uploadImage callback is set). */
  _pickImage() {
    if (!this._imageInput) {
      this._imageInput = document.createElement('input')
      this._imageInput.type = 'file'
      // Raster formats only — mirrors the server's allowlist (audit S-1)
      this._imageInput.accept = 'image/png,image/jpeg,image/webp,image/gif'
      this._imageInput.hidden = true
      this._imageInput.addEventListener('change', () => {
        const file = this._imageInput.files?.[0]
        this._imageInput.value = ''
        if (file) this._insertUploadedImage(file)
      })
      this.appendChild(this._imageInput)
    }
    this._imageInput.click()
  }

  /** Upload via the host callback, then embed the returned repo URL. */
  async _insertUploadedImage(file) {
    try {
      const url = await this.uploadImage(file)
      if (url) this.editor.chain().focus().setImage({ src: url, alt: file.name }).run()
      this._media?.refresh() // open media panel shows the new image immediately
    } catch (err) {
      this._aiStatusEl.textContent = t(this._lang, 'image.uploadError', { detail: err?.message || '?' })
      clearTimeout(this._aiStatusTimer)
      this._aiStatusTimer = setTimeout(() => { this._aiStatusEl.textContent = '' }, 6000)
    }
  }

  /** Presence chip click: jump to that user's current cursor position
   * (their relative Yjs position resolved against our editor state). */
  _jumpToUser(clientId) {
    const cursor = this.provider.awareness?.getStates?.().get(clientId)?.cursor
    const ystate = this.editor && ySyncPluginKey.getState(this.editor.state)
    if (!cursor?.head || !ystate?.binding) return
    const abs = relativePositionToAbsolutePosition(
      ystate.doc, ystate.type, createRelativePositionFromJSON(cursor.head), ystate.binding.mapping)
    if (abs !== null) this.editor.chain().setTextSelection(abs).scrollIntoView().run()
  }

  /** Deep link: jump to a TOC-style heading anchor (#slug). Returns whether
   * the slug resolved — usable by the host (e.g. from location.hash). */
  jumpToAnchor(slug) {
    if (!this.editor) return false
    const pos = findHeadingBySlug(this.editor.state.doc, slug)
    if (pos === null) return false
    this.editor.chain().setTextSelection(pos + 1).scrollIntoView().run()
    return true
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
      this._renderWordCount()
    }, 1000)
  }

  _renderWordCount() {
    if (!this._wordCountEl || !this.editor) return
    const words = (buildTextIndex(this.editor.state.doc).text.match(/\S+/g) || []).length
    // ~200 words/min reading speed
    this._wordCountEl.textContent = words
      ? t(this._lang, 'editor.wordCount', { words, min: Math.max(1, Math.ceil(words / 200)) })
      : ''
  }

  _renderToolbar() {
    buildToolbar(this)
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
    if (msg.phase === 'review') {
      // Sent to the REQUESTER only: open the selection panel
      this._aiReview.show(msg)
      set(t(this._lang, 'ai.reviewReady', { count: (msg.entities?.length || 0) + (msg.roles?.length || 0) }))
      return
    }
    if (msg.phase === 'suggested') {
      set(t(this._lang, 'ai.suggested', { count: msg.count ?? 0 }))
      return
    }
    if (msg.phase === 'discarded') {
      set(t(this._lang, 'ai.discarded'))
      return
    }
    if (msg.phase === 'done') {
      set(t(this._lang, 'ai.done', { entities: msg.entities ?? 0, roles: msg.roles ?? 0 }))
    } else if (msg.phase === 'error') {
      if (msg.code === 'cooldown') {
        set(t(this._lang, 'ai.errorCooldown', { secs: msg.retryInSec ?? '?' }), true)
        return
      }
      const key = { busy: 'ai.errorBusy', 'no-write': 'ai.errorNoWrite', 'not-configured': 'ai.errorNotConfigured', 'no-pending': 'ai.errorNoPending' }[msg.code]
      set(key ? t(this._lang, key) : t(this._lang, 'ai.errorUpstream', { detail: msg.detail || msg.code || '?' }), true)
    }
  }

  // ------------------------------------------------------- Annotations ---
  /** Controller callback: annotations changed → public event + dirty state. */
  _onAnnotationsChanged() {
    this._emit('annotations-change', { annotations: this.getAnnotations() })
    this._updateToolbar() // pill count gates the glossary button
    // Tag changes are persisted like text changes (keywords) → save countdown
    this._saveBar.noteChange()
  }

  _updateToolbar() {
    if (!this._buttons || !this.editor) return
    if (this._tagBtn) {
      this._tagBtn.disabled = !this.editor.isEditable || this.editor.state.selection.empty
    }
    if (this._glossaryBtn) {
      // raw() (cheap) instead of resolvedList(): pills existing is enough to
      // enable the button; the click filters for anchored entities anyway
      this._glossaryBtn.disabled = !this.editor.isEditable || !this._tags.raw().length
    }
    if (this._tocBtn) {
      this._tocBtn.disabled = !this.editor.isEditable || !collectHeadings(this.editor.state.doc).length
    }
    this._roles.syncSelect()
    const inTable = this.editor.isActive('table')
    const onImage = this.editor.isActive('image')
    for (const { btn, tool } of this._buttons) {
      if (tool.active) {
        const on = tool.active(this.editor)
        btn.classList.toggle('mce-active', on)
        btn.setAttribute('aria-pressed', String(on))
      }
      if (tool.table) btn.style.display = inTable ? '' : 'none'
      if (tool.image) btn.style.display = onImage ? '' : 'none'
    }
  }
}

customElements.define('md-collab-editor', MdCollabEditor)
