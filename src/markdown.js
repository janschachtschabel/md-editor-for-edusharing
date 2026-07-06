/**
 * Markdown ⇄ HTML conversion (runs in Node AND in the browser).
 *
 * Markdown → HTML: marked (GFM) + postprocessing for TipTap task lists
 * HTML → Markdown: turndown + GFM plugin (tables, strikethrough) + custom
 *                  rules for task items, sup/sub (inline HTML) and tight lists
 */
import { marked } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

// ------------------------------------------------------- Markdown → HTML ---
marked.use({ gfm: true })

/**
 * marked renders task lists as <li><input type="checkbox">…, but TipTap's
 * TaskList/TaskItem expect data-type attributes.
 */
function fixTaskListsForTiptap(html) {
  let out = html.replace(
    /<li>(\s*(?:<p>)?)\s*<input\s+(checked="")?\s*disabled=""\s+type="checkbox">\s*/g,
    (_m, prefix, checked) =>
      `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}">${prefix || ''}`,
  )
  // mark the surrounding <ul> as a task list
  out = out.replace(/<ul>(\s*<li data-type="taskItem")/g, '<ul data-type="taskList">$1')
  return out
}

export function markdownToHtml(markdown) {
  const html = marked.parse(markdown || '', { async: false })
  return fixTaskListsForTiptap(html) || '<p></p>'
}

// ------------------------------------------------------- HTML → Markdown ---
export function createTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    // Turndown's blank rule runs BEFORE all custom rules: empty <p> inside
    // table cells must not produce paragraph breaks, otherwise the GFM table
    // rows get torn apart
    blankReplacement: (_content, node) => {
      if (['TH', 'TD'].includes(node.parentNode?.nodeName)) return ''
      return node.isBlock ? '\n\n' : ''
    },
  })
  td.use(gfm) // GFM tables + strikethrough (~~)

  // sup/sub have no markdown syntax → keep them as inline HTML
  td.keep(['sup', 'sub'])

  // TipTap renders strike as <s> (the GFM plugin covers del/s/strike, but
  // keep an explicit rule to be safe)
  td.addRule('strike', {
    filter: ['s', 'del', 'strike'],
    replacement: (content) => `~~${content}~~`,
  })

  // Task items: TipTap markup <li data-type="taskItem" data-checked>…
  // (including the <label><input…></label> wrapper, which we discard)
  td.addRule('taskItemLabel', {
    filter: (node) =>
      node.nodeName === 'LABEL' && node.parentNode?.getAttribute?.('data-type') === 'taskItem',
    replacement: () => '',
  })
  td.addRule('taskItem', {
    filter: (node) =>
      node.nodeName === 'LI' && node.getAttribute?.('data-type') === 'taskItem',
    replacement: (content, node) => {
      // data-checked arrives as "true", as a bare value-less attribute
      // (zeed-dom serializer) or is missing/"false" for unchecked items
      const v = node.getAttribute('data-checked')
      const checked = v != null && v !== 'false'
      const text = content.replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n/gm, '\n    ')
      return `- [${checked ? 'x' : ' '}] ${text}\n`
    },
  })

  // TipTap wraps paragraphs inside <li>/<th>/<td> — keep them tight,
  // otherwise we get "loose lists" and broken table cells
  td.addRule('tightParagraph', {
    filter: (node) =>
      node.nodeName === 'P' && ['LI', 'TH', 'TD'].includes(node.parentNode?.nodeName),
    replacement: (content, node) => (node.nextSibling ? content + (node.parentNode.nodeName === 'LI' ? '\n\n' : ' ') : content),
  })

  return td
}

const defaultTurndown = createTurndown()

export function htmlToMarkdown(html) {
  // TipTap renders tables with a <colgroup> before the <tbody> — that stops
  // turndown-plugin-gfm from detecting the heading row (tbody must be the
  // first child)
  const cleaned = (html || '').replace(/<colgroup[\s\S]*?<\/colgroup>/gi, '')
  return defaultTurndown.turndown(cleaned)
}
