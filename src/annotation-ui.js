/**
 * UI building blocks for semantic tagging inside <md-collab-editor>:
 *   - tag dialog (create an annotation on the current selection)
 *   - manage dialog (inspect/delete annotations under a clicked span)
 *   - entity chips bar (all annotations of the document at a glance)
 *
 * Pure DOM helpers with callbacks — no knowledge of Yjs or TipTap. All popups
 * share one floating container per component root; Escape and outside clicks
 * close it. All functions take a `lang` option ('de'|'en', default 'de') for
 * the displayed text; the stored annotation `type` value is unaffected by
 * language (see entity-types.js i18n note).
 */
import { t } from './i18n.js'
import { typeLabel } from './entity-types.js'

/** Close (remove) an open annotation popup below `root`, if any. */
export function closeAnnotationPopup(root) {
  root._mcePopup?.close()
}

/** Focusable elements considered for the Tab trap inside a popup. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function openPopup(root, coords) {
  closeAnnotationPopup(root)
  const previouslyFocused = document.activeElement
  const el = document.createElement('div')
  el.className = 'mce-tag-popup'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
  el.style.left = `${Math.round(coords.left)}px`
  el.style.top = `${Math.round(coords.bottom + 6)}px`
  document.body.appendChild(el)

  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return }
    // Trap Tab/Shift+Tab inside the popup (WCAG 2.4.3 focus order) — a
    // dialog rendered in document.body (not inside the editor DOM) would
    // otherwise let keyboard focus leak into the page behind it.
    if (e.key !== 'Tab') return
    const focusable = [...el.querySelectorAll(FOCUSABLE)].filter((f) => !f.disabled)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  const onDown = (e) => { if (!el.contains(e.target)) close() }
  function close() {
    el.remove()
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('mousedown', onDown, true)
    if (root._mcePopup?.el === el) root._mcePopup = null
    // Restore focus to whatever triggered the popup (WCAG 2.4.3) — without
    // this, closing a dialog rendered in document.body drops focus to <body>
    if (previouslyFocused?.isConnected) previouslyFocused.focus()
  }
  document.addEventListener('keydown', onKey, true)
  // Defer so the click that opened the popup doesn't immediately close it
  setTimeout(() => document.addEventListener('mousedown', onDown, true), 0)
  root._mcePopup = { el, close }
  return { el, close }
}

/**
 * Dialog for tagging the current selection.
 * @param {HTMLElement} root component element (popup lifecycle owner)
 * @param {{left:number,bottom:number}} coords viewport position (selection start)
 * @param {{quote:string, types:[{value:string, label:string, group:string}],
 *          lang?:string, onSubmit:(data:{type:string, entityId:string})=>string|null}} opts
 *   `types` are suggestions (default catalog + used types) — `value` is the
 *   canonical (German) type that gets persisted, `label` its translated
 *   display text. Free input stays allowed (stored exactly as typed);
 *   onSubmit returns null on success or an error message to display.
 */
export function openTagDialog(root, coords, { quote, types, lang = 'de', onSubmit }) {
  const { el, close } = openPopup(root, coords)
  // Datalist suggestions show/select the translated label; map back to the
  // canonical value on submit so the persisted keyword stays German (Prinzip 5)
  const labelToValue = new Map(types.map((ty) => [ty.label, ty.value]))
  el.innerHTML = `
    <div class="mce-tag-quote">„${escapeHtml(shorten(quote, 60))}"</div>
    <label>${t(lang, 'tag.typeLabel')}
      <input type="text" class="mce-tag-type" list="mce-type-list" required
             placeholder="${escapeHtml(t(lang, 'tag.typePlaceholder'))}" autocomplete="off">
    </label>
    <datalist id="mce-type-list">${types.map((ty) =>
      `<option value="${escapeHtml(ty.label)}" label="${escapeHtml(ty.group)}">`).join('')}</datalist>
    <label>${t(lang, 'tag.entityIdLabel')} <span class="mce-tag-opt">${t(lang, 'tag.entityIdOptional')}</span>
      <input type="text" class="mce-tag-entity" placeholder="${escapeHtml(t(lang, 'tag.entityIdPlaceholder'))}" autocomplete="off">
    </label>
    <div class="mce-tag-error" role="alert"></div>
    <div class="mce-tag-actions">
      <button type="button" class="mce-tag-ok">${t(lang, 'tag.submit')}</button>
      <button type="button" class="mce-tag-cancel">${t(lang, 'tag.cancel')}</button>
    </div>
  `
  const typeInput = el.querySelector('.mce-tag-type')
  const submit = () => {
    const typed = typeInput.value.trim()
    if (!typed) { showError(t(lang, 'tag.typeRequiredError')); return }
    const type = labelToValue.get(typed) || typed
    const error = onSubmit({ type, entityId: el.querySelector('.mce-tag-entity').value.trim() })
    if (error) showError(error)
    else close()
  }
  const showError = (msg) => { el.querySelector('.mce-tag-error').textContent = msg }
  el.querySelector('.mce-tag-ok').addEventListener('click', submit)
  el.querySelector('.mce-tag-cancel').addEventListener('click', close)
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } })
  typeInput.focus()
}

/**
 * Dialog listing the annotations under a clicked span (innermost first),
 * with a delete button per entry when editing is allowed.
 */
export function openManageDialog(root, coords, { annotations, canDelete, onDelete, lang = 'de' }) {
  const { el, close } = openPopup(root, coords)
  const delTitle = escapeHtml(t(lang, 'manage.deleteTitle'))
  const rows = annotations.map((a) => `
    <div class="mce-tag-row" data-id="${escapeHtml(a.id)}">
      <span class="mce-tag-row-label" title="${escapeHtml(a.entityId ? t(lang, 'chips.entityIdTitle', { id: a.entityId }) : '')}">
        ${escapeHtml(shorten(a.quote, 40))} <b>(${escapeHtml(typeLabel(a.type, lang))})</b>
      </span>
      ${canDelete ? `<button type="button" class="mce-tag-del" title="${delTitle}" aria-label="${delTitle}">✕</button>` : ''}
    </div>`).join('')
  el.innerHTML = `<div class="mce-tag-title">${escapeHtml(t(lang, 'manage.title'))}</div>${rows}`
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.mce-tag-del')
    if (!btn) return
    onDelete(btn.closest('.mce-tag-row').dataset.id)
    close()
  })
}

/**
 * Render the entity chips bar: one chip per annotation ("Quote (Typ)").
 * Orphaned annotations (quote no longer in the text) are shown muted.
 */
export function renderEntityChips(container, resolved, { canEdit, onSelect, onDelete, lang = 'de' }) {
  container.innerHTML = ''
  container.style.display = resolved.length ? '' : 'none'
  for (const a of resolved) {
    const displayType = typeLabel(a.type, lang)
    const chip = document.createElement('span')
    chip.className = 'mce-entity-chip' + (a.start === null ? ' mce-entity-orphan' : '')
    chip.title = a.start === null
      ? t(lang, 'chips.orphanTitle', { quote: a.quote })
      : (a.entityId ? t(lang, 'chips.entityIdTitle', { id: a.entityId }) : t(lang, 'chips.selectTitle'))

    const label = document.createElement('button')
    label.type = 'button'
    label.className = 'mce-entity-label'
    label.textContent = `${a.quote} (${displayType})`
    label.addEventListener('click', () => onSelect(a))
    chip.appendChild(label)

    if (canEdit) {
      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'mce-entity-del'
      del.textContent = '✕'
      del.title = t(lang, 'chips.deleteTitle')
      del.setAttribute('aria-label', t(lang, 'chips.deleteAriaLabel', { label: `${a.quote} (${displayType})` }))
      del.addEventListener('click', () => onDelete(a.id))
      chip.appendChild(del)
    }
    container.appendChild(chip)
  }
}

function shorten(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}
