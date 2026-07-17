/**
 * Find & replace for <md-collab-editor>: a compact in-flow bar below the
 * toolbar (opened via the 🔍 toolbar button). Matching is case-insensitive on
 * the SAME plain-text index the entity anchoring uses (buildTextIndex), so
 * matches spanning formatting boundaries (**bold** rest) are found too.
 * Replacements run through normal editor transactions → collaborative and
 * undoable. Controller pattern like RoleUi / SaveBarUi.
 */
import { buildTextIndex } from './annotation-extension.js'
import { t } from './i18n.js'

export class FindReplaceUi {
  constructor({ barEl, getEditor, getLang }) {
    this.barEl = barEl
    this.getEditor = getEditor
    this.getLang = getLang || (() => 'de')
    this.matches = []
    this.current = -1
    this.button = null
  }

  buildButton() {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'mce-find-btn'
    btn.innerHTML = '🔍'
    btn.title = t(this.getLang(), 'find.buttonTitle')
    btn.setAttribute('aria-label', t(this.getLang(), 'find.buttonTitle'))
    btn.addEventListener('click', () => this.toggle())
    this.button = btn
    return btn
  }

  /** Build the (hidden) bar element — caller appends it below the toolbar. */
  build() {
    const lang = this.getLang()
    const bar = this.barEl
    bar.innerHTML = `
      <input type="text" class="mce-find-input" placeholder="${t(lang, 'find.findPlaceholder')}" aria-label="${t(lang, 'find.findPlaceholder')}" />
      <span class="mce-find-count" role="status" aria-live="polite"></span>
      <button type="button" class="mce-find-next">${t(lang, 'find.next')}</button>
      <input type="text" class="mce-find-replace-input" placeholder="${t(lang, 'find.replacePlaceholder')}" aria-label="${t(lang, 'find.replacePlaceholder')}" />
      <button type="button" class="mce-find-replace">${t(lang, 'find.replace')}</button>
      <button type="button" class="mce-find-replace-all">${t(lang, 'find.replaceAll')}</button>
      <button type="button" class="mce-find-close" aria-label="${t(lang, 'find.close')}">✕</button>
    `
    this.input = bar.querySelector('.mce-find-input')
    this.countEl = bar.querySelector('.mce-find-count')
    this.replaceInput = bar.querySelector('.mce-find-replace-input')
    this.input.addEventListener('input', () => this.search())
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.next() } })
    bar.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close() })
    bar.querySelector('.mce-find-next').addEventListener('click', () => this.next())
    bar.querySelector('.mce-find-replace').addEventListener('click', () => this.replaceCurrent())
    bar.querySelector('.mce-find-replace-all').addEventListener('click', () => this.replaceAll())
    bar.querySelector('.mce-find-close').addEventListener('click', () => this.close())
    return bar
  }

  toggle() {
    if (this.barEl.hidden) {
      this.barEl.hidden = false
      this.input.focus()
      this.search()
    } else this.close()
  }

  close() {
    this.barEl.hidden = true
    this.button?.focus()
  }

  /** Recompute all matches (case-insensitive) against the plain-text index. */
  search() {
    const editor = this.getEditor()
    const term = this.input.value
    this.matches = []
    this.current = -1
    if (editor && term) {
      const index = buildTextIndex(editor.state.doc)
      const haystack = index.text.toLowerCase()
      const needle = term.toLowerCase()
      let at = haystack.indexOf(needle)
      while (at !== -1) {
        const from = index.toPos(at)
        const to = index.toPos(at + needle.length)
        if (from !== null && to !== null) this.matches.push({ from, to })
        at = haystack.indexOf(needle, at + needle.length)
      }
    }
    this.countEl.textContent = term ? t(this.getLang(), 'find.count', { count: this.matches.length }) : ''
  }

  next() {
    if (!this.matches.length) return
    this.current = (this.current + 1) % this.matches.length
    const m = this.matches[this.current]
    const editor = this.getEditor()
    editor.chain().setTextSelection({ from: m.from, to: m.to }).scrollIntoView().run()
  }

  /** Replace the currently selected match, keep position, re-search. */
  replaceCurrent() {
    const editor = this.getEditor()
    if (this.current < 0 || !editor?.isEditable) return
    const m = this.matches[this.current]
    editor.chain().insertContentAt({ from: m.from, to: m.to }, this.replaceInput.value).run()
    const stay = this.current
    this.search()
    this.current = Math.min(stay, this.matches.length) - 1 // next() continues after the replacement
  }

  /** Replace every match in ONE transaction chain (back to front so earlier
   * positions stay valid). */
  replaceAll() {
    const editor = this.getEditor()
    if (!this.matches.length || !editor?.isEditable) return
    const chain = editor.chain()
    for (const m of [...this.matches].reverse()) {
      chain.insertContentAt({ from: m.from, to: m.to }, this.replaceInput.value)
    }
    chain.run()
    this.search()
  }
}
