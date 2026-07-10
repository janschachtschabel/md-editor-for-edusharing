/**
 * Markdown ⇄ HTML conversion + plain-text extraction (runs in Node AND in
 * the browser).
 *
 * Markdown → HTML:  marked (GFM) + postprocessing for TipTap task lists
 * HTML → Markdown:  turndown + GFM plugin (tables, strikethrough) + custom
 *                   rules for task items, sup/sub (inline HTML) and tight lists
 * Markdown → plain: markdownToPlainText — the anchor text for entity tags
 */
import { marked } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { generateJSON } from '@tiptap/html'
import { createExtensions } from './extensions.js'

// ------------------------------------------------------- Markdown → HTML ---
// Fenced-div extension for didactic paragraph roles:  ::: role \n …blocks… \n :::
// → <section data-role="role">…</section>. The body is parsed as normal
// markdown (nested blocks survive), matching the RoleBlock node schema.
//
// A depth-COUNTING scan (not a regex) is used so role blocks can NEST
// (sub-marking a sentence inside an already-tagged paragraph): an opener is
// "::: slug", a closer is a bare ":::". The body is re-tokenized, which
// re-triggers this extension for any nested opener.
const OPEN_RE = /^::: *([a-z0-9-]+)[ \t]*$/
const CLOSE_RE = /^::: *$/
const roleContainer = {
  name: 'roleBlock',
  level: 'block',
  start(src) { const i = src.search(/^:::/m); return i < 0 ? undefined : i },
  tokenizer(src) {
    const first = OPEN_RE.exec(src.split('\n', 1)[0])
    if (!first) return undefined
    const lines = src.split('\n')
    let depth = 0
    let end = -1
    const body = []
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (OPEN_RE.test(line)) {
        if (depth > 0) body.push(line) // nested opener belongs to the body
        depth++
      } else if (CLOSE_RE.test(line)) {
        depth--
        if (depth === 0) { end = i; break }
        body.push(line)
      } else if (depth > 0) {
        body.push(line)
      }
    }
    if (end < 0) return undefined // no matching closer → not a role block
    const token = {
      type: 'roleBlock', raw: lines.slice(0, end + 1).join('\n'),
      role: first[1], tokens: [],
    }
    this.lexer.blockTokens(body.join('\n'), token.tokens)
    return token
  },
  renderer(token) {
    return `<section data-role="${token.role}">${this.parser.parse(token.tokens)}</section>\n`
  },
}
marked.use({ gfm: true, extensions: [roleContainer] })

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

// ------------------------------------------------- Markdown → plain text ---
// Quote anchoring (entity tags) must run against the PLAIN text — the same
// text the editor's decorations/pills anchor against — NEVER against the
// markdown source: formatting splits a quote into `**bold** rest` and
// turndown escapes plain terms (`snake_case_name` → `snake\_case\_name`),
// so substring search on markdown silently loses valid anchors (audit KW-1).
// Parsed through the real editor schema (generateJSON) so the result matches
// the client's text index exactly; textblocks are joined with '\n' so quotes
// cannot falsely match across block boundaries.
const plainExtensions = createExtensions()

function collectTextblocks(node, blocks) {
  if (!node?.content) return
  if (node.content.some((c) => c.type === 'text')) {
    blocks.push(node.content.map((c) => (c.type === 'text' ? c.text || '' : '')).join(''))
    return
  }
  for (const child of node.content) collectTextblocks(child, blocks)
}

export function markdownToPlainText(markdown) {
  if (!markdown) return ''
  const blocks = []
  collectTextblocks(generateJSON(markdownToHtml(markdown), plainExtensions), blocks)
  return blocks.join('\n')
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

  // Role blocks (paragraph roles) → ::: fenced div. The inner content is
  // serialized normally; blank lines around the fences keep them block-level.
  td.addRule('roleBlock', {
    filter: (node) => node.nodeName === 'SECTION' && Boolean(node.getAttribute('data-role')),
    replacement: (content, node) => {
      const role = node.getAttribute('data-role')
      const inner = content.replace(/^\n+/, '').replace(/\n+$/, '')
      return `\n\n::: ${role}\n${inner}\n:::\n\n`
    },
  })

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
