/**
 * Export helpers for <md-collab-editor>: download the current document as a
 * .md file and open a print view. Read actions only — nothing is stored.
 *
 * Printing opens a DEDICATED window containing just the rendered document:
 * window.print() on the app page itself is not available in embedded
 * webviews (IDE preview panes, iframe embeddings report "no print preview"),
 * and the app chrome must not be printed anyway. When the popup is blocked,
 * it falls back to window.print() — the @media print rules in style.css then
 * strip the chrome.
 */

/** Download filename derived from the document name (node id): "abc-123.md".
 * The `:field` suffix and anything else unsafe in filenames becomes "-". */
export function markdownFilename(documentName) {
  const base = String(documentName || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${base || 'dokument'}.md`
}

/** Trigger a client-side download of the markdown text. */
export function downloadMarkdown(markdown, filename) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Self-contained styles for the print window (subset of public/style.css —
// the window has no access to the app's stylesheet)
const PRINT_CSS = `
  body { font-family: "Segoe UI", system-ui, sans-serif; line-height: 1.6;
         color: #111; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #bbb; padding: .3em .5em; text-align: left; vertical-align: top; }
  pre { background: #f3f4f6; padding: .8em 1em; border-radius: 6px; overflow-x: auto; }
  code { background: #f3f4f6; padding: .1em .3em; border-radius: 4px; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ccc; margin: .8em 0; padding: .2em 1em; color: #555; }
  section[data-role] { position: relative; border: 1px solid #ddd; border-left: 3px solid #888;
                       border-radius: 6px; padding: 1.5em .9em .4em; margin: 1em 0; }
  section[data-role]::before { content: attr(data-role); position: absolute; top: .35em; left: .9em;
                               font-size: .7em; font-weight: 700; text-transform: capitalize; color: #666; }
  a { color: #000; }
`

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

/** Open the print window with the rendered document HTML. */
export function openPrintView(html, title) {
  const w = window.open('', '_blank')
  if (!w) {
    window.print() // popup blocked → page print (style.css strips the chrome)
    return
  }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">`
    + `<title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head>`
    + `<body>${html}</body></html>`)
  w.document.close()
  w.focus()
  const doPrint = () => { try { w.print() } catch { /* window stays open as reading view */ } }
  // Wait for images before printing; readyState is already complete when
  // everything was cached (and in tests)
  if (w.document.readyState === 'complete') doPrint()
  else w.addEventListener('load', doPrint, { once: true })
}
