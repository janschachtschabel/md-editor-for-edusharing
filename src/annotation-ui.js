/**
 * UI building blocks for semantic tagging inside <md-collab-editor>:
 *   - tag dialog (create an annotation on the current selection)
 *   - manage dialog (inspect/delete annotations under a clicked span)
 *   - entity chips bar (all annotations of the document at a glance)
 *
 * Pure DOM helpers with callbacks — no knowledge of Yjs or TipTap. All popups
 * share one floating container per component root; Escape and outside clicks
 * close it.
 */

/** Close (remove) an open annotation popup below `root`, if any. */
export function closeAnnotationPopup(root) {
  root._mcePopup?.close()
}

function openPopup(root, coords) {
  closeAnnotationPopup(root)
  const el = document.createElement('div')
  el.className = 'mce-tag-popup'
  el.setAttribute('role', 'dialog')
  el.style.left = `${Math.round(coords.left)}px`
  el.style.top = `${Math.round(coords.bottom + 6)}px`
  document.body.appendChild(el)

  const onKey = (e) => { if (e.key === 'Escape') close() }
  const onDown = (e) => { if (!el.contains(e.target)) close() }
  function close() {
    el.remove()
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('mousedown', onDown, true)
    if (root._mcePopup?.el === el) root._mcePopup = null
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
 * @param {{quote:string, types:[{value:string, group:string}],
 *          onSubmit:(data:{type:string, entityId:string})=>string|null}} opts
 *   `types` are suggestions (default catalog + used types) — free input stays
 *   allowed; onSubmit returns null on success or an error message to display.
 */
export function openTagDialog(root, coords, { quote, types, onSubmit }) {
  const { el, close } = openPopup(root, coords)
  el.innerHTML = `
    <div class="mce-tag-quote">„${escapeHtml(shorten(quote, 60))}"</div>
    <label>Typ
      <input type="text" class="mce-tag-type" list="mce-type-list" required
             placeholder="z. B. Person, Ort, Fachbegriff" autocomplete="off">
    </label>
    <datalist id="mce-type-list">${types.map((t) =>
      `<option value="${escapeHtml(t.value)}" label="${escapeHtml(t.group)}">`).join('')}</datalist>
    <label>Entity-ID <span class="mce-tag-opt">(optional)</span>
      <input type="text" class="mce-tag-entity" placeholder="z. B. keyword:xyz oder Node-ID" autocomplete="off">
    </label>
    <div class="mce-tag-error" role="alert"></div>
    <div class="mce-tag-actions">
      <button type="button" class="mce-tag-ok">Taggen</button>
      <button type="button" class="mce-tag-cancel">Abbrechen</button>
    </div>
  `
  const typeInput = el.querySelector('.mce-tag-type')
  const submit = () => {
    const type = typeInput.value.trim()
    if (!type) { showError('Bitte einen Typ angeben.'); return }
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
export function openManageDialog(root, coords, { annotations, canDelete, onDelete }) {
  const { el, close } = openPopup(root, coords)
  const rows = annotations.map((a) => `
    <div class="mce-tag-row" data-id="${escapeHtml(a.id)}">
      <span class="mce-tag-row-label" title="${escapeHtml(a.entityId ? `Entity: ${a.entityId}` : '')}">
        ${escapeHtml(shorten(a.quote, 40))} <b>(${escapeHtml(a.type)})</b>
      </span>
      ${canDelete ? '<button type="button" class="mce-tag-del" title="Tag entfernen" aria-label="Tag entfernen">✕</button>' : ''}
    </div>`).join('')
  el.innerHTML = `<div class="mce-tag-title">Entitäten an dieser Stelle</div>${rows}`
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
export function renderEntityChips(container, resolved, { canEdit, onSelect, onDelete }) {
  container.innerHTML = ''
  container.style.display = resolved.length ? '' : 'none'
  for (const a of resolved) {
    const chip = document.createElement('span')
    chip.className = 'mce-entity-chip' + (a.start === null ? ' mce-entity-orphan' : '')
    chip.title = a.start === null
      ? `„${a.quote}" kommt nicht mehr im Text vor — wird beim Speichern trotzdem als Keyword geführt`
      : (a.entityId ? `Entity: ${a.entityId}` : 'Klick: Stelle anzeigen')

    const label = document.createElement('button')
    label.type = 'button'
    label.className = 'mce-entity-label'
    label.textContent = `${a.quote} (${a.type})`
    label.addEventListener('click', () => onSelect(a))
    chip.appendChild(label)

    if (canEdit) {
      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'mce-entity-del'
      del.textContent = '✕'
      del.title = 'Tag entfernen'
      del.setAttribute('aria-label', `Tag ${a.quote} (${a.type}) entfernen`)
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
