/**
 * TipTap extension that renders standoff annotations as ProseMirror
 * DECORATIONS — the document itself stays untouched (no marks, no markup in
 * the markdown export). Annotation ranges are resolved on every relevant
 * update by quote + occurrence search in the document's plain text.
 *
 * Options:
 *   getAnnotations()               → current annotation list (plain objects)
 *   onAnnotationClick(hits, event) → user clicked a tagged span; `hits` are
 *                                    the resolved annotations covering the
 *                                    position (innermost first)
 *
 * The host triggers a re-render after external annotation changes (Y.Array
 * updates) via editor.commands.refreshAnnotations().
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findAllQuoteRanges } from './annotations.js'

const key = new PluginKey('mce-annotations')

/**
 * Build a searchable plain-text view of the document plus a mapping between
 * text offsets and ProseMirror positions. Blocks are separated by '\n' so
 * quotes cannot falsely match across block boundaries.
 */
export function buildTextIndex(doc) {
  let text = ''
  const segments = [] // {start, end (text offsets), pos (pm position of segment start)}
  doc.descendants((node, pos) => {
    if (node.isText) {
      segments.push({ start: text.length, end: text.length + node.text.length, pos })
      text += node.text
    } else if (node.isBlock && text.length > 0 && !text.endsWith('\n')) {
      text += '\n'
    }
    return true
  })
  return {
    text,
    /** text offset → ProseMirror position (null for separator offsets) */
    toPos(offset) {
      for (const s of segments) {
        if (offset >= s.start && offset <= s.end) return s.pos + (offset - s.start)
      }
      return null
    },
    /** ProseMirror position → text offset (null outside text nodes) */
    fromPos(pos) {
      for (const s of segments) {
        const len = s.end - s.start
        if (pos >= s.pos && pos <= s.pos + len) return s.start + (pos - s.pos)
      }
      return null
    },
  }
}

/**
 * Resolve annotations to PM ranges: [{annotation, from, to}]. A tagged
 * entity is ONE pill/keyword, but EVERY occurrence of its exact wording is
 * highlighted here — not just the anchor occurrence used for the chip and
 * the keyword anchor (see findAllQuoteRanges).
 */
function resolveToPmRanges(annotations, doc) {
  const index = buildTextIndex(doc)
  const ranges = []
  for (const a of annotations) {
    for (const r of findAllQuoteRanges(index.text, a.quote)) {
      const from = index.toPos(r.start)
      const to = index.toPos(r.end)
      if (from === null || to === null || from >= to) continue
      ranges.push({ annotation: a, from, to })
    }
  }
  return ranges
}

function buildDecorations(annotations, doc) {
  // Early exit for the common untagged case: without it, every keystroke
  // would rebuild the full text index just to decorate nothing (audit F-T4)
  if (!annotations.length) return DecorationSet.empty
  const decorations = resolveToPmRanges(annotations, doc).map(({ annotation, from, to }) =>
    Decoration.inline(from, to, {
      class: 'mce-entity',
      'data-annotation-id': annotation.id,
      'data-entity-type': annotation.type,
      title: `${annotation.quote} (${annotation.type})`,
    }))
  return DecorationSet.create(doc, decorations)
}

export const AnnotationDecorations = Extension.create({
  name: 'annotationDecorations',

  addOptions() {
    return {
      getAnnotations: () => [],
      onAnnotationClick: null,
    }
  },

  addCommands() {
    return {
      /** Recompute decorations after external annotation changes. */
      refreshAnnotations: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(key, 'refresh'))
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const { getAnnotations, onAnnotationClick } = this.options
    return [
      new Plugin({
        key,
        state: {
          init: (_config, state) => buildDecorations(getAnnotations(), state.doc),
          apply: (tr, old, _oldState, newState) => {
            if (!tr.docChanged && !tr.getMeta(key)) return old
            return buildDecorations(getAnnotations(), newState.doc)
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)
          },
          handleClick(view, pos, event) {
            if (!onAnnotationClick) return false
            const hits = resolveToPmRanges(getAnnotations(), view.state.doc)
              .filter(({ from, to }) => pos >= from && pos < to)
              .sort((x, y) => (x.to - x.from) - (y.to - y.from)) // innermost first
              .map(({ annotation }) => annotation)
            if (hits.length === 0) return false
            onAnnotationClick(hits, event)
            return true
          },
        },
      }),
    ]
  },
})
