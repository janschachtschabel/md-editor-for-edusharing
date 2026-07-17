/**
 * AI suggestion review for <md-collab-editor>: the server answers an "ai-tag"
 * request with VALIDATED suggestions (stateless 'ai-status' phase 'review',
 * sent to the requester only) instead of applying them. This bar lists every
 * suggestion with a checkbox; "apply" sends the kept indices back as
 * 'ai-apply' (the server re-validates on application), "discard" clears the
 * pending set. Controller pattern like FindReplaceUi.
 */
import { roleLabel } from './entity-types.js'
import { t } from './i18n.js'

export class AiReviewUi {
  constructor({ barEl, getLang, sendCommand }) {
    this.barEl = barEl
    this.getLang = getLang || (() => 'de')
    this.sendCommand = sendCommand // (obj) => provider.sendStateless(JSON)
  }

  /** Render the review bar for one suggestion set. */
  show({ entities = [], roles = [] }) {
    const lang = this.getLang()
    const bar = this.barEl
    bar.innerHTML = ''
    const title = document.createElement('strong')
    title.className = 'mce-ai-review-title'
    title.textContent = t(lang, 'ai.review.title')
    bar.appendChild(title)

    const addItem = (group, index, label) => {
      const wrap = document.createElement('label')
      wrap.className = 'mce-ai-review-item'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = true
      box.dataset.group = group
      box.dataset.index = String(index)
      wrap.appendChild(box)
      wrap.appendChild(document.createTextNode(` ${label}`))
      bar.appendChild(wrap)
    }
    entities.forEach((e, i) => addItem('entities', i, `${e.quote} (${e.type})`))
    roles.forEach((r, i) => addItem('roles', i,
      `${t(lang, 'ai.review.rolePrefix')} ${roleLabel(r.role, lang)}: „${r.quote}“`
      + (r.endQuote ? ` … „${r.endQuote}“` : '')))

    const apply = document.createElement('button')
    apply.type = 'button'
    apply.className = 'mce-ai-review-apply'
    apply.textContent = t(lang, 'ai.review.apply')
    apply.addEventListener('click', () => {
      const keep = { keepEntities: [], keepRoles: [] }
      for (const box of bar.querySelectorAll('input[type="checkbox"]')) {
        if (!box.checked) continue
        keep[box.dataset.group === 'roles' ? 'keepRoles' : 'keepEntities'].push(Number(box.dataset.index))
      }
      this.sendCommand({ event: 'ai-apply', ...keep })
      this.hide()
    })
    bar.appendChild(apply)

    const discard = document.createElement('button')
    discard.type = 'button'
    discard.className = 'mce-ai-review-discard'
    discard.textContent = t(lang, 'ai.review.discard')
    discard.addEventListener('click', () => {
      this.sendCommand({ event: 'ai-discard' })
      this.hide()
    })
    bar.appendChild(discard)
    bar.hidden = false
  }

  hide() {
    this.barEl.hidden = true
  }
}
