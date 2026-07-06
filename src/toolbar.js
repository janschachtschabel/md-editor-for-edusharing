/**
 * Toolbar definition for the <md-collab-editor> component.
 * Each entry: {cmd, label, title, run, active?, table?} — `table: true`
 * shows the button only while the selection is inside a table.
 * Every action maps losslessly to markdown (GFM).
 */
export const TOOLBAR = [
  { cmd: 'bold', label: '<b>B</b>', title: 'Fett', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  { cmd: 'italic', label: '<i>I</i>', title: 'Kursiv', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
  { cmd: 'strike', label: '<s>S</s>', title: 'Durchgestrichen', run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive('strike') },
  { cmd: 'code', label: '&lt;/&gt;', title: 'Inline-Code', run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive('code') },
  { cmd: 'sup', label: 'x²', title: 'Hochgestellt', run: (e) => e.chain().focus().toggleSuperscript().run(), active: (e) => e.isActive('superscript') },
  { cmd: 'sub', label: 'x₂', title: 'Tiefgestellt', run: (e) => e.chain().focus().toggleSubscript().run(), active: (e) => e.isActive('subscript') },
  { sep: true },
  { cmd: 'h1', label: 'H1', title: 'Überschrift 1', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive('heading', { level: 1 }) },
  { cmd: 'h2', label: 'H2', title: 'Überschrift 2', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
  { cmd: 'h3', label: 'H3', title: 'Überschrift 3', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }) },
  { sep: true },
  { cmd: 'bulletList', label: '• Liste', title: 'Liste', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { cmd: 'orderedList', label: '1. Liste', title: 'Nummerierte Liste', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { cmd: 'taskList', label: '☑ Tasks', title: 'Task-Liste', run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive('taskList') },
  { cmd: 'blockquote', label: '❝', title: 'Zitat', run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
  { cmd: 'codeBlock', label: '{ }', title: 'Code-Block', run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive('codeBlock') },
  { cmd: 'hr', label: '―', title: 'Trennlinie', run: (e) => e.chain().focus().setHorizontalRule().run() },
  { sep: true },
  { cmd: 'link', label: '🔗', title: 'Link', active: (e) => e.isActive('link'), run: (e) => {
    const prev = e.getAttributes('link').href || ''
    const url = window.prompt('Link-URL (leer = entfernen):', prev)
    if (url === null) return
    if (url === '') e.chain().focus().unsetLink().run()
    else e.chain().focus().setLink({ href: url }).run()
  } },
  { cmd: 'image', label: '🖼', title: 'Bild (URL)', run: (e) => {
    const url = window.prompt('Bild-URL:')
    if (url) e.chain().focus().setImage({ src: url }).run()
  } },
  { sep: true },
  { cmd: 'table', label: '⊞ Tabelle', title: 'Tabelle einfügen (3×3)', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { cmd: 'rowAdd', label: '+Zeile', title: 'Zeile darunter einfügen', table: true, run: (e) => e.chain().focus().addRowAfter().run() },
  { cmd: 'colAdd', label: '+Spalte', title: 'Spalte rechts einfügen', table: true, run: (e) => e.chain().focus().addColumnAfter().run() },
  { cmd: 'rowDel', label: '−Zeile', title: 'Zeile löschen', table: true, run: (e) => e.chain().focus().deleteRow().run() },
  { cmd: 'colDel', label: '−Spalte', title: 'Spalte löschen', table: true, run: (e) => e.chain().focus().deleteColumn().run() },
  { cmd: 'tableDel', label: '⊞✕', title: 'Tabelle löschen', table: true, run: (e) => e.chain().focus().deleteTable().run() },
  { sep: true },
  { cmd: 'undo', label: '↶', title: 'Rückgängig', run: (e) => e.chain().focus().undo().run() },
  { cmd: 'redo', label: '↷', title: 'Wiederholen', run: (e) => e.chain().focus().redo().run() },
]
