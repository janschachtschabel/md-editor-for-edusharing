/**
 * Paragraph-role UI for <md-collab-editor> (the SECOND tagging system, see
 * docs/ABSATZROLLEN.md): the toolbar <select> (one exclusive role per block,
 * unlike the multi-toggle entity tagging) and the amber role-chips bar.
 * Extracted from the web component following the AnnotationController /
 * PresenceTracker pattern — the component wires DOM slots and lifecycle,
 * features live in their own modules.
 */
import { DEFAULT_BLOCK_ROLES, roleLabel } from './entity-types.js'
import { t } from './i18n.js'

export class RoleUi {
  constructor({ rolesEl, getEditor, getLang }) {
    this.rolesEl = rolesEl
    this.getEditor = getEditor
    this.getLang = getLang || (() => 'de')
    this.select = null
  }

  /** Build the toolbar <select> (caller appends it to the toolbar). */
  buildSelect() {
    const lang = this.getLang()
    const select = document.createElement('select')
    select.className = 'mce-role-select'
    select.title = t(lang, 'toolbar.roleTitle')
    select.setAttribute('aria-label', t(lang, 'toolbar.roleTitle'))
    select.appendChild(new Option(t(lang, 'toolbar.roleNone'), ''))
    select.appendChild(new Option(t(lang, 'toolbar.roleClear'), '__clear__'))
    const group = document.createElement('optgroup')
    group.label = t(lang, 'toolbar.roleGroupLabel')
    for (const r of DEFAULT_BLOCK_ROLES) group.appendChild(new Option(roleLabel(r.slug, lang), r.slug))
    select.appendChild(group)
    select.addEventListener('change', () => {
      const editor = this.getEditor()
      const v = select.value
      if (v === '__clear__') editor.chain().focus().unsetRole().run()
      else if (v) editor.chain().focus().setRole(v).run()
      this.syncSelect()
    })
    this.select = select
    return select
  }

  /** Mirror the current block's role in the select (called on every transaction). */
  syncSelect() {
    const editor = this.getEditor()
    if (!this.select || !editor) return
    this.select.disabled = !editor.isEditable
    const slug = editor.isActive('roleBlock') ? (editor.getAttributes('roleBlock').role || '') : ''
    // A free role authored outside the catalog: add it so the select can
    // reflect it instead of falling back to the placeholder
    if (slug && ![...this.select.options].some((o) => o.value === slug)) {
      this.select.add(new Option(slug, slug))
    }
    this.select.value = slug
  }

  /** Render the role chips bar (removable) — the block-level counterpart to
   * the entity chips bar. Reads the roles straight from the document. */
  renderChips() {
    const editor = this.getEditor()
    if (!this.rolesEl || !editor) return
    const lang = this.getLang()
    const roles = []
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'roleBlock') roles.push({ role: node.attrs.role, pos })
    })
    // Runs on EVERY doc update — skip the DOM rebuild while the (common)
    // no-roles state is unchanged (audit 6, P-2)
    if (!roles.length && this.rolesEl.style.display === 'none') return
    this.rolesEl.innerHTML = ''
    this.rolesEl.style.display = roles.length ? '' : 'none'
    const editable = editor.isEditable
    for (const r of roles) {
      const chip = document.createElement('span')
      chip.className = 'mce-role-chip'
      const label = document.createElement('button')
      label.type = 'button'
      label.className = 'mce-role-chip-label'
      label.textContent = roleLabel(r.role, lang)
      label.title = t(lang, 'roleChip.selectTitle')
      label.addEventListener('click', () => {
        editor.chain().focus().setTextSelection(r.pos + 1).scrollIntoView().run()
      })
      chip.appendChild(label)
      if (editable) {
        const del = document.createElement('button')
        del.type = 'button'
        del.className = 'mce-role-chip-del'
        del.textContent = '✕'
        del.title = t(lang, 'roleChip.removeTitle')
        del.setAttribute('aria-label', t(lang, 'roleChip.removeAria', { label: roleLabel(r.role, lang) }))
        del.addEventListener('click', () => {
          editor.chain().focus().setTextSelection(r.pos + 1).unsetRole().run()
        })
        chip.appendChild(del)
      }
      this.rolesEl.appendChild(chip)
    }
    if (editable && roles.length >= 2) {
      const clear = document.createElement('button')
      clear.type = 'button'
      clear.className = 'mce-chips-clear'
      clear.textContent = t(lang, 'roleChip.clearAll')
      clear.title = t(lang, 'roleChip.clearAllTitle')
      clear.setAttribute('aria-label', t(lang, 'roleChip.clearAllTitle'))
      clear.addEventListener('click', () => {
        if (window.confirm(t(lang, 'roleChip.clearAllConfirm', { count: roles.length }))) {
          editor.chain().focus().unsetAllRoles().run()
        }
      })
      this.rolesEl.appendChild(clear)
    }
  }
}
