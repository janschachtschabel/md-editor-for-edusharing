/**
 * Toolbar definition for the <md-collab-editor> component.
 * Each entry: {cmd, label, titleKey, run, active?, table?} — `table: true`
 * shows the button only while the selection is inside a table.
 * Every action maps losslessly to markdown (GFM).
 *
 * `label` is for pure glyphs/abbreviations (B, H1, ↶ — language-independent);
 * buttons whose visible text contains WORDS carry `labelKey` instead and are
 * translated like `titleKey` (tooltip/aria-label) — both resolve via i18n
 * with the language <md-collab-editor> activated before rendering.
 */
import { tt } from './i18n.js'

export const TOOLBAR = [
  { cmd: 'bold', label: '<b>B</b>', titleKey: 'toolbar.bold', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  { cmd: 'italic', label: '<i>I</i>', titleKey: 'toolbar.italic', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
  { cmd: 'strike', label: '<s>S</s>', titleKey: 'toolbar.strike', run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive('strike') },
  { cmd: 'code', label: '&lt;/&gt;', titleKey: 'toolbar.code', run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive('code') },
  { cmd: 'sup', label: 'x²', titleKey: 'toolbar.sup', run: (e) => e.chain().focus().toggleSuperscript().run(), active: (e) => e.isActive('superscript') },
  { cmd: 'sub', label: 'x₂', titleKey: 'toolbar.sub', run: (e) => e.chain().focus().toggleSubscript().run(), active: (e) => e.isActive('subscript') },
  { sep: true },
  { cmd: 'h1', label: 'H1', titleKey: 'toolbar.h1', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive('heading', { level: 1 }) },
  { cmd: 'h2', label: 'H2', titleKey: 'toolbar.h2', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
  { cmd: 'h3', label: 'H3', titleKey: 'toolbar.h3', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }) },
  { sep: true },
  { cmd: 'bulletList', labelKey: 'toolbar.bulletListLabel', titleKey: 'toolbar.bulletList', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { cmd: 'orderedList', labelKey: 'toolbar.orderedListLabel', titleKey: 'toolbar.orderedList', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { cmd: 'taskList', labelKey: 'toolbar.taskListLabel', titleKey: 'toolbar.taskList', run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive('taskList') },
  { cmd: 'blockquote', label: '❝', titleKey: 'toolbar.blockquote', run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
  { cmd: 'codeBlock', label: '{ }', titleKey: 'toolbar.codeBlock', run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive('codeBlock') },
  { cmd: 'hr', label: '―', titleKey: 'toolbar.hr', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { sep: true },
  { cmd: 'link', label: '🔗', titleKey: 'toolbar.link', active: (e) => e.isActive('link'), run: (e) => {
    const prev = e.getAttributes('link').href || ''
    const url = window.prompt(tt('toolbar.linkPrompt'), prev)
    if (url === null) return
    if (url === '') e.chain().focus().unsetLink().run()
    else e.chain().focus().setLink({ href: url }).run()
  } },
  { cmd: 'image', label: '🖼', titleKey: 'toolbar.image', run: (e) => {
    const url = window.prompt(tt('toolbar.imagePrompt'))
    if (url) e.chain().focus().setImage({ src: url }).run()
  } },
  // Image sizing — shown only while an image is selected (`image: true`,
  // same contextual pattern as the table buttons). Width persists as a raw
  // HTML img (markdown has no size syntax); ⛶ returns to pure markdown.
  { cmd: 'imgS', label: 'S', titleKey: 'toolbar.imgSmall', image: true, active: (e) => e.getAttributes('image').width === 240, run: (e) => e.chain().focus().updateAttributes('image', { width: 240 }).run() },
  { cmd: 'imgM', label: 'M', titleKey: 'toolbar.imgMedium', image: true, active: (e) => e.getAttributes('image').width === 480, run: (e) => e.chain().focus().updateAttributes('image', { width: 480 }).run() },
  { cmd: 'imgL', label: 'L', titleKey: 'toolbar.imgLarge', image: true, active: (e) => e.getAttributes('image').width === 720, run: (e) => e.chain().focus().updateAttributes('image', { width: 720 }).run() },
  { cmd: 'imgFull', label: '⛶', titleKey: 'toolbar.imgFull', image: true, active: (e) => !e.getAttributes('image').width, run: (e) => e.chain().focus().updateAttributes('image', { width: null }).run() },
  { sep: true },
  { cmd: 'table', labelKey: 'toolbar.tableLabel', titleKey: 'toolbar.table', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { cmd: 'rowAdd', labelKey: 'toolbar.rowAddLabel', titleKey: 'toolbar.rowAdd', table: true, run: (e) => e.chain().focus().addRowAfter().run() },
  { cmd: 'colAdd', labelKey: 'toolbar.colAddLabel', titleKey: 'toolbar.colAdd', table: true, run: (e) => e.chain().focus().addColumnAfter().run() },
  { cmd: 'rowDel', labelKey: 'toolbar.rowDelLabel', titleKey: 'toolbar.rowDel', table: true, run: (e) => e.chain().focus().deleteRow().run() },
  { cmd: 'colDel', labelKey: 'toolbar.colDelLabel', titleKey: 'toolbar.colDel', table: true, run: (e) => e.chain().focus().deleteColumn().run() },
  { cmd: 'tableDel', label: '⊞✕', titleKey: 'toolbar.tableDel', table: true, run: (e) => e.chain().focus().deleteTable().run() },
  { sep: true },
  { cmd: 'undo', label: '↶', titleKey: 'toolbar.undo', run: (e) => e.chain().focus().undo().run() },
  { cmd: 'redo', label: '↷', titleKey: 'toolbar.redo', run: (e) => e.chain().focus().redo().run() },
]
