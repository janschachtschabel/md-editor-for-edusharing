/**
 * Shared TipTap extension set for the server (schema, HTML⇄JSON) and the
 * web component (editor). Must be identical on both sides, otherwise the
 * Yjs document and the editor schema won't match.
 *
 * Selection criterion: everything here maps losslessly to markdown (GFM) —
 * sup/sub as inline HTML (<sup>/<sub>), which markdown explicitly allows.
 * Deliberately disabled: underline (bundled in StarterKit v3 but has no
 * markdown equivalent), highlight, text-align.
 */
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { RoleBlock } from './role-block.js'

export function createExtensions() {
  return [
    RoleBlock, // didactic paragraph roles (::: container), see role-block.js
    StarterKit.configure({
      undoRedo: false, // undo/redo is handled by Yjs
      underline: false, // no markdown equivalent — keep the round trip lossless
      link: { openOnClick: false }, // Link ships inside StarterKit since v3
    }),
    Image.configure({ inline: false }),
    Superscript,
    Subscript,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
  ]
}
