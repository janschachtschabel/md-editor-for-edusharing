/**
 * Annotation feature controller for <md-collab-editor>: owns the shared
 * Y.Array('annotations'), validation (crossing rule, type rules), the tag/
 * manage dialogs and the entity chips bar. Extracted from the component so
 * the web component keeps a single responsibility (editor/collab/save UI).
 *
 * Wiring (all late-bound so the controller can be created before the editor):
 *   getEditor()  → current TipTap editor instance
 *   onChange()   → annotations changed (own or remote) — component marks the
 *                  document dirty and emits its public event
 */
import {
  findQuoteRange, isCrossing, isValidType, occurrenceOfIndex, resolveAnnotations,
} from './annotations.js'
import { buildTypeOptions } from './entity-types.js'
import { buildTextIndex } from './annotation-extension.js'
import {
  closeAnnotationPopup, openManageDialog, openTagDialog, renderEntityChips,
} from './annotation-ui.js'

export class AnnotationController {
  constructor({ root, entitiesEl, annotations, getEditor, onChange }) {
    this.root = root
    this.entitiesEl = entitiesEl
    this.annotations = annotations // Y.Array in the shared Yjs document
    this.getEditor = getEditor
    this.onChange = onChange
    this._observer = () => this._changed()
    this.annotations.observe(this._observer)
  }

  dispose() {
    closeAnnotationPopup(this.root)
    this.annotations.unobserve(this._observer)
  }

  /** Raw annotation objects (for the decoration extension). */
  raw() {
    return this.annotations.toArray()
  }

  /** Standoff export: annotations with offsets resolved against `text`. */
  list(text) {
    return resolveAnnotations(this.raw(), text)
  }

  /**
   * Programmatic tagging — the AI entry point ("quotes for the AI, offsets
   * for the code"): callers pass the exact wording, positions are resolved
   * here. Returns an error message (quote not found / crossing) or null.
   */
  add({ quote, type, entityId = '', occurrence = 1 }) {
    const editor = this.getEditor()
    if (!editor || !quote || !type) return 'quote und type sind erforderlich'
    const index = buildTextIndex(editor.state.doc)
    const range = findQuoteRange(index.text, quote, occurrence)
    if (!range) return `Zitat nicht im Text gefunden: „${quote}"`
    return this._push({ quote, type, entityId, occurrence }, range, index.text)
  }

  /** Toolbar action: tag the current selection via the popup dialog. */
  openTagDialog() {
    const editor = this.getEditor()
    const { state, view } = editor
    const { from, to } = state.selection
    if (from === to) return
    const index = buildTextIndex(state.doc)
    const start = index.fromPos(from)
    const end = index.fromPos(to)
    const quote = start !== null && end !== null ? index.text.slice(start, end) : ''
    if (!quote || quote.includes('\n')) {
      openTagDialog(this.root, view.coordsAtPos(from), {
        quote: quote || '—', types: [], onSubmit: () => 'Die Auswahl darf keine Absätze überspannen.',
      })
      return
    }
    openTagDialog(this.root, view.coordsAtPos(from), {
      quote,
      types: buildTypeOptions(this.raw().map((a) => a.type)),
      onSubmit: ({ type, entityId }) => this._push(
        { quote, type, entityId, occurrence: occurrenceOfIndex(index.text, quote, start) },
        { start, end }, index.text,
      ),
    })
  }

  /** Click on a decorated span (from the extension): manage popup. */
  handleClick(hits, event) {
    openManageDialog(this.root, { left: event.clientX, bottom: event.clientY }, {
      annotations: hits,
      canDelete: this.getEditor().isEditable,
      onDelete: (id) => this._delete(id),
    })
  }

  /** Entity chips bar: all annotations at a glance (orphans muted). */
  renderChips() {
    const editor = this.getEditor()
    if (!this.entitiesEl || !editor) return
    const index = buildTextIndex(editor.state.doc)
    renderEntityChips(this.entitiesEl, this.list(index.text), {
      canEdit: editor.isEditable,
      onSelect: (a) => this._select(a),
      onDelete: (id) => this._delete(id),
    })
  }

  /** Y.Array changed (own or remote): decorations, chips, notify component. */
  _changed() {
    this.getEditor()?.commands.refreshAnnotations()
    this.renderChips()
    this.onChange()
  }

  /** Validate (type rules, crossing rule) and append to the shared Y.Array. */
  _push({ quote, type, entityId, occurrence }, range, text) {
    if (!isValidType(type)) {
      return 'Ungültiger Typ — Klammern sind nicht erlaubt (der Typ wird als „Name (Typ)" gespeichert).'
    }
    for (const a of this.list(text)) {
      if (a.start !== null && isCrossing(range, a)) {
        return `Kreuzt bestehendes Tag „${a.quote} (${a.type})" — erlaubt sind nur verschachtelte oder deckungsgleiche Tags.`
      }
    }
    this.annotations.push([{
      id: (crypto.randomUUID?.() || Math.random().toString(36).slice(2)),
      quote,
      occurrence,
      type,
      ...(entityId ? { entityId } : {}),
    }])
    return null
  }

  _delete(id) {
    const i = this.raw().findIndex((a) => a.id === id)
    if (i !== -1) this.annotations.delete(i, 1)
  }

  /** Chip click: select and scroll to the tagged text. */
  _select(a) {
    const editor = this.getEditor()
    const index = buildTextIndex(editor.state.doc)
    const range = findQuoteRange(index.text, a.quote, a.occurrence || 1)
    if (!range) return
    const from = index.toPos(range.start)
    const to = index.toPos(range.end)
    if (from === null || to === null) return
    editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run()
  }
}
