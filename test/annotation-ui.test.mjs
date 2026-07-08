// DOM tests for the semantic-tagging popups (src/annotation-ui.js), using
// jsdom since these are the only annotation-feature module with zero prior
// coverage despite being pure DOM logic (no TipTap/Yjs dependency) — see
// audit finding F-1 (missing aria-modal/focus-trap/focus-restore) and T-1
// (untested annotation UI).
import { JSDOM } from 'jsdom'
import {
  closeAnnotationPopup, openManageDialog, openTagDialog, renderEntityChips,
} from '../src/annotation-ui.js'

let fail = 0
function check(name, ok, extra = '') {
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : extra)
}

// jsdom setup: annotation-ui.js uses document/window globals directly (same
// as it does in the real browser bundle), so install them on `global` for
// the duration of this file.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
global.window = dom.window
global.document = dom.window.document

function makeRoot() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  return root
}

// --- openTagDialog: rendering, submit mapping, accessibility ---------------
{
  const root = makeRoot()
  const trigger = document.createElement('button')
  document.body.appendChild(trigger)
  trigger.focus()

  const types = [
    { value: 'Ort', label: 'Place', group: 'People, Places' },
    { value: 'Person', label: 'Person', group: 'People, Places' },
  ]
  let submitted = null
  openTagDialog(root, { left: 10, bottom: 10 }, {
    quote: 'Weimar',
    types,
    lang: 'en',
    onSubmit: (data) => { submitted = data; return null },
  })

  const dialog = document.querySelector('.mce-tag-popup')
  check('dialog is rendered', Boolean(dialog))
  check('dialog has role=dialog', dialog.getAttribute('role') === 'dialog')
  check('dialog has aria-modal=true (F-1)', dialog.getAttribute('aria-modal') === 'true')
  check('quote is shown', dialog.textContent.includes('Weimar'))

  const typeInput = dialog.querySelector('.mce-tag-type')
  typeInput.value = 'Place' // the translated label, as shown in the datalist
  dialog.querySelector('.mce-tag-ok').click()

  check('submit maps the translated label back to the canonical value', submitted?.type === 'Ort')
  check('dialog closes on successful submit', !document.querySelector('.mce-tag-popup'))
  check('focus returns to the trigger element after close (F-1)', document.activeElement === trigger)

  document.body.innerHTML = ''
}

// --- openTagDialog: validation error keeps the dialog open -----------------
{
  const root = makeRoot()
  let submitCalls = 0
  openTagDialog(root, { left: 0, bottom: 0 }, {
    quote: 'Weimar',
    types: [],
    lang: 'en',
    onSubmit: () => { submitCalls++; return null },
  })
  const dialog = document.querySelector('.mce-tag-popup')
  dialog.querySelector('.mce-tag-type').value = '  '
  dialog.querySelector('.mce-tag-ok').click()
  check('empty type shows an error instead of submitting', submitCalls === 0)
  check('error message is rendered', dialog.querySelector('.mce-tag-error').textContent.length > 0)
  check('dialog stays open after a validation error', Boolean(document.querySelector('.mce-tag-popup')))

  document.body.innerHTML = ''
}

// --- Escape closes the popup and restores focus -----------------------------
{
  const root = makeRoot()
  const trigger = document.createElement('button')
  document.body.appendChild(trigger)
  trigger.focus()
  openTagDialog(root, { left: 0, bottom: 0 }, { quote: 'x', types: [], onSubmit: () => null })
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  check('Escape closes the dialog', !document.querySelector('.mce-tag-popup'))
  check('Escape restores focus to the trigger (F-1)', document.activeElement === trigger)

  document.body.innerHTML = ''
}

// --- closeAnnotationPopup: explicit close from the host ---------------------
{
  const root = makeRoot()
  openTagDialog(root, { left: 0, bottom: 0 }, { quote: 'x', types: [], onSubmit: () => null })
  check('popup is open', Boolean(document.querySelector('.mce-tag-popup')))
  closeAnnotationPopup(root)
  check('closeAnnotationPopup removes it', !document.querySelector('.mce-tag-popup'))

  document.body.innerHTML = ''
}

// --- openManageDialog: lists tags, translates type, delete wiring ----------
{
  const root = makeRoot()
  let deletedId = null
  openManageDialog(root, { left: 0, bottom: 0 }, {
    annotations: [{ id: 'a1', quote: 'Weimar', type: 'Ort' }],
    canDelete: true,
    onDelete: (id) => { deletedId = id },
    lang: 'en',
  })
  const dialog = document.querySelector('.mce-tag-popup')
  check('manage dialog has aria-modal=true (F-1)', dialog.getAttribute('aria-modal') === 'true')
  check('type is shown translated', dialog.textContent.includes('Place'))
  dialog.querySelector('.mce-tag-del').click()
  check('delete button invokes onDelete with the annotation id', deletedId === 'a1')
  check('manage dialog closes after delete', !document.querySelector('.mce-tag-popup'))

  document.body.innerHTML = ''
}

// --- renderEntityChips: labels, orphan state, delete callback ---------------
{
  const container = document.createElement('div')
  document.body.appendChild(container)
  let deleted = null
  renderEntityChips(container, [
    { id: 'a1', quote: 'Weimar', type: 'Ort', start: 0, end: 6 },
    { id: 'a2', quote: 'Goethe', type: 'Person', start: null, end: null },
  ], { canEdit: true, onSelect: () => {}, onDelete: (id) => { deleted = id }, lang: 'en' })

  const chips = container.querySelectorAll('.mce-entity-chip')
  check('renders one chip per annotation', chips.length === 2)
  check('chip label uses the translated type', chips[0].textContent.includes('Weimar (Place)'))
  check('orphaned annotation gets the orphan class', chips[1].classList.contains('mce-entity-orphan'))
  chips[0].querySelector('.mce-entity-del').click()
  check('chip delete button invokes onDelete', deleted === 'a1')

  document.body.innerHTML = ''
}

process.exit(fail ? 1 : 0)
