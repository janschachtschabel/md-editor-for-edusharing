/**
 * TipTap extension that highlights passages carrying a node comment with a
 * »quote« text anchor (see src/comments-ui.js) — as pure ProseMirror
 * DECORATIONS, exactly like the entity decorations: the document and its
 * markdown stay untouched, the comment data itself lives ONLY in the
 * edu-sharing comment API. Anchors resolve live against the plain text
 * (buildTextIndex + findQuoteRange, first occurrence — the same rule the
 * panel's quote-jump uses); an edited-away passage simply loses its mark.
 *
 * Options:
 *   getAnchors()          → [{id, quote}] of anchored comments
 *   onCommentClick(ids)   → user clicked a marked passage (comment ids)
 *   getLang()             → UI language for the tooltip
 *
 * The comments controller triggers a re-render after list changes via
 * editor.commands.refreshCommentMarks().
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { buildTextIndex } from './annotation-extension.js'
import { findQuoteRange } from './annotations.js'
import { t } from './i18n.js'

const key = new PluginKey('mce-comment-marks')

/** Resolve anchors to PM ranges, grouping comments that quote the same
 * passage into one range: [{from, to, ids}]. */
function resolveRanges(anchors, doc) {
  const index = buildTextIndex(doc)
  const byRange = new Map()
  for (const a of anchors) {
    const range = findQuoteRange(index.text, a.quote)
    if (!range) continue // passage edited away → no mark
    const from = index.toPos(range.start)
    const to = index.toPos(range.end)
    if (from === null || to === null || from >= to) continue
    const k = `${from}-${to}`
    if (!byRange.has(k)) byRange.set(k, { from, to, ids: [] })
    byRange.get(k).ids.push(a.id)
  }
  return [...byRange.values()]
}

function buildDecorations(anchors, doc, lang) {
  if (!anchors.length) return DecorationSet.empty
  const decorations = resolveRanges(anchors, doc).map(({ from, to, ids }) =>
    Decoration.inline(from, to, {
      class: 'mce-comment-mark',
      title: t(lang, 'comments.markTitle', { count: ids.length }),
    }))
  return DecorationSet.create(doc, decorations)
}

export const CommentMarks = Extension.create({
  name: 'commentMarks',

  addOptions() {
    return {
      getAnchors: () => [],
      onCommentClick: null,
      getLang: () => 'de',
    }
  },

  addCommands() {
    return {
      /** Recompute the marks after the comment list changed. */
      refreshCommentMarks: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(key, 'refresh'))
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const { getAnchors, onCommentClick, getLang } = this.options
    return [
      new Plugin({
        key,
        state: {
          init: (_config, state) => buildDecorations(getAnchors(), state.doc, getLang()),
          apply: (tr, old, _oldState, newState) => {
            if (!tr.docChanged && !tr.getMeta(key)) return old
            return buildDecorations(getAnchors(), newState.doc, getLang())
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)
          },
          handleClick(view, pos) {
            if (!onCommentClick) return false
            const hit = resolveRanges(getAnchors(), view.state.doc)
              .find(({ from, to }) => pos >= from && pos < to)
            if (!hit) return false
            onCommentClick(hit.ids)
            return true
          },
        },
      }),
    ]
  },
})
