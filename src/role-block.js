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
       * Apply a role to the block(s) in the current selection. If already
       * inside a role block, just change its role; otherwise wrap.
       */
      setRole: (role) => ({ editor, commands }) =>
        editor.isActive('roleBlock')
          ? commands.updateAttributes('roleBlock', { role })
          : commands.wrapIn('roleBlock', { role }),

      /** Remove the surrounding role block, lifting its content back out. */
      unsetRole: () => ({ commands }) => commands.lift('roleBlock'),
    }
  },
})
