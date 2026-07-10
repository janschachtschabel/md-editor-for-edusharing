/**
 * RoleBlock — a TipTap node for didactic paragraph roles (Einleitung,
 * Definition, Aufgabe…). Unlike inline entities (which are standoff
 * annotations → keywords), a role is STRUCTURE and lives IN the document:
 * a container that wraps one or more blocks and serializes to a `:::` fenced
 * div in the markdown (see src/markdown.js). It therefore travels through
 * Yjs and the markdown roundtrip like any other block, and never touches
 * cclom:general_keyword.
 *
 * Pure schema definition (no DOM) so it can be part of the shared extension
 * set used on both the server (generateHTML/JSON) and the browser (editor).
 * The `role` attribute holds the slug (e.g. "definition"); the display label
 * is resolved via roleLabel() in entity-types.js.
 */
import { Node } from '@tiptap/core'
import { findWrapping } from '@tiptap/pm/transform'

/** True if the resolved position sits inside a roleBlock ancestor. */
function inRoleBlock($pos) {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'roleBlock') return true
  }
  return false
}

export const RoleBlock = Node.create({
  name: 'roleBlock',
  group: 'block',
  content: 'block+',
  defining: true, // keep the wrapper on paste/replace instead of merging away

  addAttributes() {
    return {
      role: {
        default: 'hinweis',
        parseHTML: (el) => el.getAttribute('data-role') || 'hinweis',
        renderHTML: (attrs) => ({ 'data-role': attrs.role }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'section[data-role]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['section', HTMLAttributes, 0]
  },

  addCommands() {
    return {
      /**
       * Apply a role.
       *  - No / whole-block / multi-block selection → the role applies to the
       *    whole block: re-label it if it already is a role block, else wrap it.
       *  - A PARTIAL selection inside one paragraph → the selected text is
       *    split off into its OWN paragraph and wrapped in a role block. If
       *    that paragraph sits inside another role block, the result nests
       *    (sub-marking a sentence inside a tagged paragraph); otherwise it
       *    becomes a top-level role block. Surrounding text keeps its role.
       */
      setRole: (role) => ({ state, tr, dispatch, commands }) => {
        const { $from, $to, empty } = state.selection

        // Cursor only (no text selected) → act on the WHOLE current block:
        // re-label it if it already is a role block, else wrap it.
        if (empty) {
          return inRoleBlock($from)
            ? commands.updateAttributes('roleBlock', { role })
            : commands.wrapIn('roleBlock', { role })
        }

        // Any non-empty selection → the SELECTED text becomes its own role
        // block (nested if it sits inside another role block). This is the key
        // distinction from the cursor case and fixes the bug where selecting a
        // whole inner paragraph re-labelled the entire multi-paragraph block.
        const sameBlock = $from.parent === $to.parent && $from.parent.isTextblock
        // Selection spanning several blocks → wrap them all in one role block.
        if (!sameBlock) return commands.wrapIn('roleBlock', { role })

        // Selection inside a single paragraph (partial OR the whole paragraph):
        // split it off and wrap just that paragraph. Only mutate when actually
        // dispatching — TipTap dispatches `tr` itself when we return true.
        if (!dispatch) return true
        const atStart = $from.parentOffset === 0
        const atEnd = $to.parentOffset === $from.parent.content.size
        // Split the tail first so the head split position stays valid.
        if (!atEnd) tr.split($to.pos)
        if (!atStart) tr.split($from.pos)
        const $mid = tr.doc.resolve(tr.mapping.map($from.pos) + 1)
        const range = $mid.blockRange()
        const wrapping = range && findWrapping(range, this.type, { role })
        if (!wrapping) return false
        tr.wrap(range, wrapping)
        return true
      },

      /**
       * Remove EVERY role block in the document, unwrapping each in place.
       * Runs in passes (unwrap the first hit, rescan) so nested role blocks —
       * whose recorded positions would go stale after unwrapping their parent
       * — are handled correctly; all passes share one transaction.
       */
      unsetAllRoles: () => ({ tr, dispatch }) => {
        let any = false
        let found = true
        while (found) {
          found = false
          tr.doc.descendants((node, pos) => {
            if (found) return false
            if (node.type.name === 'roleBlock') {
              if (dispatch) tr.replaceWith(pos, pos + node.nodeSize, node.content)
              any = true
              found = Boolean(dispatch) // without dispatch: just report applicability
              return false
            }
            return true
          })
          if (!dispatch) break
        }
        return any
      },

      /**
       * Remove the nearest surrounding role block, unwrapping its content IN
       * PLACE (not `lift`, which would only un-nest a nested role by one level
       * instead of removing it). The content keeps its position and parent.
       */
      unsetRole: () => ({ state, tr, dispatch }) => {
        const { $from } = state.selection
        let depth = -1
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'roleBlock') { depth = d; break }
        }
        if (depth < 0) return false
        if (dispatch) {
          const start = $from.before(depth)
          const node = $from.node(depth)
          tr.replaceWith(start, start + node.nodeSize, node.content)
        }
        return true
      },
    }
  },
})
