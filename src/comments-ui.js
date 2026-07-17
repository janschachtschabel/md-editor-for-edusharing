/**
 * Node-comment panel for <md-collab-editor> — a slide-in on the RIGHT edge.
 * The component stays repository-agnostic: the host injects
 * `el.commentsApi = { list(), add(text, replyTo), remove(id) }` (the demo
 * host proxies edu-sharing's node-comment API). Features: threaded replies
 * (one level, matching edu-sharing), delete for own comments, and an
 * optional TEXT ANCHOR — an active editor selection is stored as a leading
 * »quote« that jumps back to the passage on click (resolved live against the
 * plain text, like entity pills). Comment text is rendered via textContent
 * only (comments may contain foreign HTML — never inject it).
 */
import { buildTextIndex } from './annotation-extension.js'
import { findQuoteRange } from './annotations.js'
import { t } from './i18n.js'

const QUOTE_RE = /^»([^«\n]{1,160})« ?/

export class CommentsUi {
  constructor({ panelEl, getEditor, getLang, getApi, onItemsChanged }) {
    this.panelEl = panelEl
    this.getEditor = getEditor
    this.getLang = getLang || (() => 'de')
    this.getApi = getApi
    this.onItemsChanged = onItemsChanged || (() => {}) // feeds the in-text marks
    this.items = [] // last loaded comment list (anchors resolve against it)
    this.replyTo = null
    this.button = null
  }

  /** Fetch the comment list WITHOUT opening the panel — feeds the in-text
   * comment marks (src/comment-marks.js). A failed fetch just leaves the
   * marks absent; the panel shows the real error when opened. */
  async preload() {
    const api = this.getApi()
    if (!api) return
    try {
      this.items = await api.list()
    } catch {
      return
    }
    this.onItemsChanged()
  }

  /** {id, quote} of every comment carrying a »quote« text anchor. */
  anchoredQuotes() {
    const out = []
    for (const item of this.items) {
      const m = QUOTE_RE.exec(item.text || '')
      if (m && item.id) out.push({ id: item.id, quote: m[1] })
    }
    return out
  }

  /** Open the panel and highlight one comment (in-text mark was clicked). */
  async openAt(id) {
    await this.open()
    const el = [...this.panelEl.querySelectorAll('[data-comment-id]')]
      .find((e) => e.dataset.commentId === String(id))
    if (!el) return
    el.scrollIntoView?.({ block: 'nearest' })
    el.classList.add('mce-comment-flash')
    setTimeout(() => el.classList.remove('mce-comment-flash'), 1600)
  }

  /** Toolbar button — the component shows it once a commentsApi is set. */
  buildButton() {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'mce-comments-btn'
    btn.innerHTML = '💬'
    btn.title = t(this.getLang(), 'comments.buttonTitle')
    btn.setAttribute('aria-label', t(this.getLang(), 'comments.buttonTitle'))
    btn.style.display = 'none'
    btn.addEventListener('click', () => this.toggle())
    this.button = btn
    return btn
  }

  toggle() {
    if (this.panelEl.hidden) this.open()
    else this.close()
  }

  async open() {
    this.panelEl.hidden = false
    this.replyTo = null
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
    try {
      this.items = await api.list()
    } catch {
      this.panelEl.querySelector('.mce-comments-list').textContent = t(lang, 'comments.loadError')
      return
    }
    this._renderList(this.items)
    this.onItemsChanged() // panel actions (send/delete) also move the marks
  }

  _renderSkeleton() {
    const lang = this.getLang()
    this.panelEl.innerHTML = `
      <div class="mce-comments-head">
        <strong>${t(lang, 'comments.title')}</strong>
        <button type="button" class="mce-comments-close" aria-label="${t(lang, 'comments.close')}">✕</button>
      </div>
      <div class="mce-comments-list" aria-live="polite">…</div>
      <div class="mce-comments-form">
        <span class="mce-comments-replyhint" hidden></span>
        <textarea class="mce-comments-input" rows="3" placeholder="${t(lang, 'comments.placeholder')}"></textarea>
        <button type="button" class="mce-comments-send">${t(lang, 'comments.send')}</button>
      </div>
    `
    this.panelEl.querySelector('.mce-comments-close').addEventListener('click', () => this.close())
    this.panelEl.querySelector('.mce-comments-send').addEventListener('click', () => this._send())
  }

  _renderList(items) {
    const lang = this.getLang()
    const list = this.panelEl.querySelector('.mce-comments-list')
    list.innerHTML = ''
    const tops = items.filter((i) => !i.replyTo)
    if (!tops.length) {
      list.textContent = t(lang, 'comments.empty')
      return
    }
    for (const top of tops) {
      list.appendChild(this._renderItem(top, false))
      for (const reply of items.filter((i) => i.replyTo === top.id)) {
        list.appendChild(this._renderItem(reply, true))
      }
    }
  }

  _renderItem(item, isReply) {
    const lang = this.getLang()
    const el = document.createElement('div')
    el.className = 'mce-comment' + (isReply ? ' mce-comment-reply' : '')
    if (item.id) el.dataset.commentId = item.id // openAt() jump target
    const head = document.createElement('div')
    head.className = 'mce-comment-head'
    const author = document.createElement('strong')
    author.textContent = item.author || '?'
    head.appendChild(author)
    const time = document.createElement('span')
    time.className = 'mce-comment-time'
    time.textContent = item.created ? new Date(item.created).toLocaleString(lang === 'en' ? 'en-GB' : 'de-DE') : ''
    head.appendChild(time)
    el.appendChild(head)

    const body = document.createElement('div')
    body.className = 'mce-comment-body'
    const match = QUOTE_RE.exec(item.text || '')
    if (match) {
      const quoteBtn = document.createElement('button')
      quoteBtn.type = 'button'
      quoteBtn.className = 'mce-comment-quote'
      quoteBtn.textContent = `»${match[1]}«`
      quoteBtn.title = t(lang, 'comments.quoteJumpTitle')
      quoteBtn.addEventListener('click', () => this._jumpToQuote(match[1]))
      body.appendChild(quoteBtn)
    }
    const text = document.createElement('span')
    text.textContent = match ? (item.text || '').slice(match[0].length) : (item.text || '')
    body.appendChild(text)
    el.appendChild(body)

    const actions = document.createElement('div')
    actions.className = 'mce-comment-actions'
    if (!isReply) {
      const reply = document.createElement('button')
      reply.type = 'button'
      reply.className = 'mce-comment-replybtn'
      reply.textContent = t(lang, 'comments.replyBtn')
      reply.addEventListener('click', () => {
        this.replyTo = item.id
        const hint = this.panelEl.querySelector('.mce-comments-replyhint')
        hint.hidden = false
        hint.textContent = t(lang, 'comments.replyingTo', { name: item.author || '?' })
        this.panelEl.querySelector('.mce-comments-input').focus()
      })
      actions.appendChild(reply)
    }
    if (item.isOwn) {
      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'mce-comment-del'
      del.textContent = '✕'
      del.title = t(lang, 'comments.deleteTitle')
      del.addEventListener('click', async () => {
        if (!window.confirm(t(lang, 'comments.deleteConfirm'))) return
        try { await this.getApi().remove(item.id) } catch { /* list below shows the truth */ }
        await this.refresh()
      })
      actions.appendChild(del)
    }
    el.appendChild(actions)
    return el
  }

  _jumpToQuote(quote) {
    const editor = this.getEditor()
    if (!editor) return
    const index = buildTextIndex(editor.state.doc)
    const range = findQuoteRange(index.text, quote)
    const from = range && index.toPos(range.start)
    if (from === null || from === undefined) return
    editor.chain().setTextSelection({ from, to: index.toPos(range.end) ?? from }).scrollIntoView().run()
  }

  async _send() {
    const input = this.panelEl.querySelector('.mce-comments-input')
    let text = input.value.trim()
    if (!text) return
    // An active editor selection becomes the comment's text anchor
    const editor = this.getEditor()
    const sel = editor?.state.selection
    if (sel && sel.to > sel.from) {
      const quote = editor.state.doc.textBetween(sel.from, sel.to, '\n').slice(0, 120)
      if (quote && !quote.includes('\n')) text = `»${quote}« ${text}`
    }
    try {
      await this.getApi().add(text, this.replyTo)
      input.value = ''
      this.replyTo = null
      await this.refresh()
    } catch {
      this.panelEl.querySelector('.mce-comments-replyhint').hidden = false
      this.panelEl.querySelector('.mce-comments-replyhint').textContent = t(this.getLang(), 'comments.sendError')
    }
  }
}
