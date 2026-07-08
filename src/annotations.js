/**
 * Pure semantic-annotation logic (runs in Node AND in the browser, no DOM).
 *
 * Standoff model: annotations live NEXT TO the text, never inside it. An
 * annotation is anchored by its quote (exact wording) plus an occurrence
 * counter — offsets are always derived deterministically via string search
 * ("offsets are for the code, quotes are for the AI"). This survives
 * collaborative editing because every client resolves against the same
 * shared text, and it lets AI-generated annotations enter the system
 * without any position arithmetic.
 *
 *   {id, quote, occurrence, type, entityId?}
 *
 * Persistence: entities are serialized into general keywords in the
 * human-readable, machine-parsable form "Name (Typ)", e.g. "Weimar (Stadt)".
 * Keywords that don't match the pattern are treated as plain keywords and
 * preserved untouched.
 *
 * Overlap policy: nested and identical spans are allowed, CROSSING spans are
 * rejected (see concept §4/§5 — crossing boundaries don't occur in our
 * educational texts and usually indicate a modelling error).
 */

/**
 * A type is valid when it is non-empty and free of parentheses — parentheses
 * would break the "Name (Typ)" keyword roundtrip (parseKeyword).
 */
export function isValidType(type) {
  const t = String(type || '').trim()
  return t.length > 0 && !/[()]/.test(t)
}

/** Serialize an entity as a general keyword: "Weimar (Stadt)". */
export function formatKeyword({ quote, type }) {
  return `${quote} (${type})`
}

/**
 * Parse a general keyword back into {quote, type}, or null for plain
 * keywords. The name may itself contain parentheses ("Willy Brandt (SPD)");
 * only the LAST "(…)" group counts as the type.
 */
export function parseKeyword(keyword) {
  const m = /^(.+) \(([^()]+)\)$/.exec(String(keyword || '').trim())
  if (!m) return null
  return { quote: m[1], type: m[2] }
}

/**
 * Find the character range of the n-th occurrence of a quote.
 * @returns {{start: number, end: number}|null} null = quote not found (e.g.
 *   the text changed or an AI hallucinated the wording) — caller must skip.
 */
export function findQuoteRange(text, quote, occurrence = 1) {
  if (!quote) return null
  let start = -1
  for (let i = 0; i < occurrence; i++) {
    start = text.indexOf(quote, start + 1)
    if (start === -1) return null
  }
  return { start, end: start + quote.length }
}

/** Which occurrence of `quote` starts at `index`? (inverse of findQuoteRange) */
export function occurrenceOfIndex(text, quote, index) {
  let n = 0
  let pos = -1
  do {
    pos = text.indexOf(quote, pos + 1)
    if (pos === -1) return 0
    n++
  } while (pos < index)
  return pos === index ? n : 0
}

/**
 * Crossing check: ranges may be disjoint, nested or identical — but must not
 * cross (partial overlap without containment).
 */
export function isCrossing(a, b) {
  const overlap = a.start < b.end && b.start < a.end
  if (!overlap) return false
  const contained = (a.start <= b.start && b.end <= a.end) || (b.start <= a.start && a.end <= b.end)
  return !contained
}

/**
 * Resolve annotations against the current text: attaches {start, end} per
 * annotation (null when the quote is no longer found — "orphaned").
 */
export function resolveAnnotations(annotations, text) {
  return annotations.map((a) => {
    const range = findQuoteRange(text, a.quote, a.occurrence || 1)
    return { ...a, start: range ? range.start : null, end: range ? range.end : null }
  })
}

/**
 * Load path: turn stored general keywords into annotations by locating each
 * entity's quote in the text (first occurrence). Plain keywords and entities
 * whose quote does not occur in the text are skipped.
 */
export function keywordsToAnnotations(keywords, text) {
  const annotations = []
  for (const keyword of keywords || []) {
    const parsed = parseKeyword(keyword)
    if (!parsed) continue
    if (!findQuoteRange(text, parsed.quote)) continue
    annotations.push({
      id: `kw-${annotations.length}-${Date.now().toString(36)}`,
      quote: parsed.quote,
      occurrence: 1,
      type: parsed.type,
    })
  }
  return annotations
}

/**
 * Save path: derive the general-keyword list from the annotations. Plain
 * (non-pattern) keywords from the repository are preserved, entity keywords
 * are rebuilt from the current annotations and deduplicated (two tags on
 * different occurrences of the same entity produce one keyword).
 */
export function annotationsToKeywords(annotations, existingKeywords = []) {
  const plain = (existingKeywords || []).filter((k) => !parseKeyword(k))
  const entity = []
  for (const a of annotations || []) {
    const kw = formatKeyword(a)
    if (!entity.includes(kw)) entity.push(kw)
  }
  return [...plain, ...entity]
}
