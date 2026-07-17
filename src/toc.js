/**
 * In-content table of contents: builds or updates a `::: inhaltsverzeichnis`
 * role block at the TOP of the document — a nested bullet list of standard
 * markdown links `[Heading](#slug)`. Slugs follow the GitHub convention
 * (lowercase, punctuation stripped, spaces → hyphens, umlauts kept), so the
 * links ALSO work in every renderer that auto-anchors headings (GitHub,
 * GitLab, Pandoc). Inside the editor, anchor clicks are resolved via
 * findHeadingBySlug (wired in md-collab-editor.js) — jumping therefore works
 * in edit AND viewer mode. The fixed role slug makes the button idempotent:
 * a second click replaces the directory instead of appending a copy.
 */
import { t } from './i18n.js'

export const TOC_ROLE = 'inhaltsverzeichnis'

/** GitHub-style anchor slug for a heading text. */
export function headingSlug(text) {
  return text.toLowerCase().trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

/**
 * All headings of the document with position and de-duplicated slug
 * ("-1", "-2" suffixes like GitHub). The TOC's own block is skipped, so the
 * directory never lists (or links) its own heading.
 */
export function collectHeadings(doc) {
  const headings = []
  const used = new Map()
  doc.descendants((node, pos) => {
    if (node.type.name === 'roleBlock' && node.attrs.role === TOC_ROLE) return false
    if (node.type.name !== 'heading' || !node.textContent.trim()) return undefined
    const base = headingSlug(node.textContent)
    const n = used.get(base) || 0
    used.set(base, n + 1)
    headings.push({ level: node.attrs.level, text: node.textContent, pos, slug: n ? `${base}-${n}` : base })
    return undefined
  })
  return headings
}

/** Position of the heading a `#slug` anchor points to (null = not found). */
export function findHeadingBySlug(doc, slug) {
  const target = decodeURIComponent(slug)
  const hit = collectHeadings(doc).find((h) => h.slug === target)
  return hit ? hit.pos : null
}

/** Nested bulletList JSON from the flat heading list (levels may skip). */
function buildList(headings) {
  const root = { level: Number.NEGATIVE_INFINITY, children: [] }
  const stack = [root]
  for (const h of headings) {
    while (stack.length > 1 && h.level <= stack[stack.length - 1].level) stack.pop()
    const node = { h, level: h.level, children: [] }
    stack[stack.length - 1].children.push(node)
    stack.push(node)
  }
  const toList = (nodes) => ({
    type: 'bulletList',
    content: nodes.map((n) => ({
      type: 'listItem',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', marks: [{ type: 'link', attrs: { href: `#${n.h.slug}` } }], text: n.h.text }],
        },
        ...(n.children.length ? [toList(n.children)] : []),
      ],
    })),
  })
  return toList(root.children)
}

/**
 * Insert or update the directory block at the top of the document (an
 * existing block is replaced in place, wherever the authors moved it).
 * @returns {boolean} false when the document has no headings
 */
export function upsertToc(editor, lang = 'de') {
  const headings = collectHeadings(editor.state.doc)
  if (!headings.length) return false
  const block = {
    type: 'roleBlock',
    attrs: { role: TOC_ROLE },
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t(lang, 'toc.heading') }] },
      buildList(headings),
    ],
  }
  let existing = null
  editor.state.doc.descendants((node, pos) => {
    if (!existing && node.type.name === 'roleBlock' && node.attrs.role === TOC_ROLE) {
      existing = { from: pos, to: pos + node.nodeSize }
    }
  })
  if (existing) editor.chain().insertContentAt(existing, block).run()
  else editor.chain().insertContentAt(0, block).run()
  return true
}
