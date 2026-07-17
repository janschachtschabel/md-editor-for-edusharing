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

/**
 * Image with an optional width attribute (pixels). Markdown has no size
 * syntax, but CommonMark allows raw HTML — a sized image round-trips as
 * `<img src… width…>` (see the turndown rule in markdown.js), which GitHub
 * and friends render; unsized images stay pure `![alt](url)` markdown.
 */
const toInt = (v) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
const SizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // The base extension carries width/height as STRINGS from parseHTML,
      // while the size buttons set NUMBERS — normalize to numbers so the
      // active state survives a reload and re-setting the same size stays a
      // no-op (audit B-1)
      width: {
        default: null,
        parseHTML: (el) => toInt(el.getAttribute('width')),
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
      height: {
        default: null,
        parseHTML: (el) => toInt(el.getAttribute('height')),
        renderHTML: (attrs) => (attrs.height ? { height: attrs.height } : {}),
      },
    }
  },
})
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
    SizableImage.configure({ inline: false }),
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
