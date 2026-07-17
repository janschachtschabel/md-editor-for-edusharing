/**
 * Media management panel for <md-collab-editor> — a slide-in on the RIGHT
 * edge (same pattern as the comments panel). The component stays
 * repository-agnostic: the host injects
 * `el.mediaApi = { list(), remove(imageId) }` (the demo host proxies the
 * editor-image routes; the images themselves are mdimg- child-IOs under the
 * node — the repository stays the ONLY storage). Features: thumbnails,
 * a referenced-in-text flag (checked against the current markdown),
 * re-inserting a stored image at the cursor, and deleting — with a stronger
 * warning while the image is still referenced (the text would keep a dead
 * image URL; the automatic orphan cleanup only ever removes UNreferenced
 * images, see server/images.js).
 */
import { t } from './i18n.js'

export class MediaUi {
  constructor({ panelEl, getEditor, getMarkdown, getLang, getApi, getUploader }) {
    this.panelEl = panelEl
    this.getEditor = getEditor
    this.getMarkdown = getMarkdown
    this.getLang = getLang || (() => 'de')
    this.getApi = getApi
    this.getUploader = getUploader || (() => null) // () => opens the file picker
  }

  toggle() {
    if (this.panelEl.hidden) this.open()
    else this.close()
  }

  async open() {
    this.panelEl.hidden = false
    await this.refresh()
  }

  close() {
    this.panelEl.hidden = true
  }

  async refresh() {
    const lang = this.getLang()
    const api = this.getApi()
    if (!api || this.panelEl.hidden) return
    this._renderSkeleton()
    let items
    try {
      items = await api.list()
    } catch {
      this.panelEl.querySelector('.mce-media-list').textContent = t(lang, 'media.loadError')
      return
    }
    this._renderList(items || [])
  }

  _renderSkeleton() {
    const lang = this.getLang()
    const uploader = this.getUploader()
    // Upload/URL both end in a document insertion — pointless (and upload
    // would orphan a repo image) while the editor is not editable (audit B-2)
    const disabled = this.getEditor()?.isEditable ? '' : 'disabled'
    this.panelEl.innerHTML = `
      <div class="mce-media-head">
        <strong>${t(lang, 'media.title')}</strong>
        <span class="mce-media-head-actions">
          ${uploader ? `<button type="button" class="mce-media-upload" ${disabled} title="${t(lang, 'media.uploadTitle')}">${t(lang, 'media.upload')}</button>` : ''}
          <button type="button" class="mce-media-url" ${disabled} title="${t(lang, 'media.insertUrlTitle')}">${t(lang, 'media.insertUrl')}</button>
          <button type="button" class="mce-media-close" aria-label="${t(lang, 'media.close')}">✕</button>
        </span>
      </div>
      <div class="mce-media-list" aria-live="polite">…</div>
    `
    this.panelEl.querySelector('.mce-media-close').addEventListener('click', () => this.close())
    // Upload entry point — the file picker the 🖼 button used to open directly
    this.panelEl.querySelector('.mce-media-upload')?.addEventListener('click', () => this.getUploader()())
    // External image by URL (the classic markdown way, no repository storage)
    this.panelEl.querySelector('.mce-media-url').addEventListener('click', () => {
      const url = window.prompt(t(lang, 'toolbar.imagePrompt'))
      if (url) this.getEditor().chain().focus().setImage({ src: url }).run()
    })
  }

  _renderList(items) {
    const lang = this.getLang()
    const list = this.panelEl.querySelector('.mce-media-list')
    list.innerHTML = ''
    if (!items.length) {
      list.textContent = t(lang, 'media.empty')
      return
    }
    const markdown = this.getMarkdown()
    const editable = Boolean(this.getEditor()?.isEditable)
    for (const item of items) {
      list.appendChild(this._renderItem(item, markdown.includes(item.imageId), editable))
    }
  }

  _renderItem(item, referenced, editable) {
    const lang = this.getLang()
    const el = document.createElement('div')
    el.className = 'mce-media-item'
    const thumb = document.createElement('img')
    thumb.src = item.url
    thumb.alt = ''
    thumb.loading = 'lazy'
    el.appendChild(thumb)
    const name = document.createElement('span')
    name.className = 'mce-media-name'
    name.textContent = item.name || item.imageId
    name.title = item.name || ''
    el.appendChild(name)
    if (referenced) {
      const used = document.createElement('span')
      used.className = 'mce-media-used'
      used.textContent = t(lang, 'media.referenced')
      used.title = t(lang, 'media.referencedTitle')
      el.appendChild(used)
    }
    const insert = document.createElement('button')
    insert.type = 'button'
    insert.className = 'mce-media-insert'
    insert.textContent = t(lang, 'media.insert')
    insert.title = t(lang, 'media.insertTitle')
    insert.disabled = !editable
    insert.addEventListener('click', () => {
      const alt = String(item.name || '').replace(/^mdimg-/, '')
      this.getEditor().chain().focus().setImage({ src: item.url, alt }).run()
      this.refresh() // the just-inserted image is referenced now
    })
    el.appendChild(insert)
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'mce-media-del'
    del.textContent = '✕'
    del.title = t(lang, 'media.deleteTitle')
    del.addEventListener('click', async () => {
      const key = referenced ? 'media.deleteConfirmReferenced' : 'media.deleteConfirm'
      if (!window.confirm(t(lang, key, { name: item.name || item.imageId }))) return
      try { await this.getApi().remove(item.imageId) } catch { /* list below shows the truth */ }
      await this.refresh()
    })
    el.appendChild(del)
    return el
  }
}
