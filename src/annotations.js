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

/**
 * A quote must be non-empty, within a reasonable length and single-block.
 * Length: an arbitrarily long selection would be embedded verbatim into a
 * "Name (Typ)" keyword with no client-side feedback, surfacing only as a
 * late edu-sharing save error (audit L-1). Newline: the text index joins
 * blocks with '\n', so a multi-block quote could anchor across a block
 * boundary — the dialog path already rejects this, and validating it here
 * closes the programmatic add() path too (audit F-T6).
 */
export const MAX_QUOTE_LENGTH = 200
export function isValidQuote(quote) {
  const q = String(quote || '')
  return q.length > 0 && q.length <= MAX_QUOTE_LENGTH && !q.includes('\n')
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

/**
 * All occurrences of a quote in the text (empty array if not found). Used
 * for rendering: a tagged entity is ONE pill (one annotation, one keyword —
 * see serializeEntityKeywords), but every mention of the same wording is
 * highlighted in the editor, not just the anchor occurrence.
 */
export function findAllQuoteRanges(text, quote) {
  if (!quote) return []
  const ranges = []
  let start = -1
  for (;;) {
    start = text.indexOf(quote, start + 1)
    if (start === -1) break
    ranges.push({ start, end: start + quote.length })
  }
  return ranges
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
 * entity's quote in the text (first occurrence).
 *
 * A keyword is only "consumed" as an editor entity when it matches the
 * "Name (Typ)" pattern AND its quote occurs verbatim in the text. This is the
 * ONLY reliable signal that a keyword is editor-managed rather than
 * pre-existing editorial metadata — the parenthesized shape alone is NOT
 * enough, since human keywords use parentheses too (disambiguation like
 * "Merkur (Planet)"). Anything not consumed (plain keywords AND parenthesized
 * keywords whose word is absent) is reported back so the caller preserves it
 * untouched (audit F-T1: pre-existing metadata must never vanish on save).
 *
 * @returns {{annotations: object[], consumed: string[]}} consumed = the exact
 *   keyword strings that became annotations.
 */
export function keywordsToAnnotations(keywords, text) {
  const annotations = []
  const consumed = []
  const seen = new Set() // exact duplicates in the repo list → one pill, not two
  for (const keyword of keywords || []) {
    if (seen.has(keyword)) continue
    seen.add(keyword)
    const parsed = parseKeyword(keyword)
    if (!parsed) continue
    if (!findQuoteRange(text, parsed.quote)) continue
    annotations.push({
      id: `kw-${annotations.length}-${Date.now().toString(36)}`,
      quote: parsed.quote,
      occurrence: 1,
      type: parsed.type,
    })
    consumed.push(keyword)
  }
  return { annotations, consumed }
}

/**
 * The pre-existing keywords that are NOT editor-managed and must be written
 * back unchanged: everything except the ones consumed as annotations.
 */
export function preservedKeywords(allKeywords, consumed) {
  const consumedSet = new Set(consumed || [])
  return (allKeywords || []).filter((k) => !consumedSet.has(k))
}

/**
 * Save path (entities): serialize the current annotations to "Name (Typ)"
 * keywords, deduplicated — two tags on different occurrences of the same
 * entity produce one keyword.
 */
export function serializeEntityKeywords(annotations) {
  const out = []
  for (const a of annotations || []) {
    const kw = formatKeyword(a)
    if (!out.includes(kw)) out.push(kw)
  }
  return out
}

/**
 * Save path (final list): preserved pre-existing keywords first, then the
 * current entity keywords, deduplicated. Preserved keeps its original order;
 * an entity that coincides with a preserved keyword is not duplicated.
 */
export function mergeKeywords(preserved, entityKeywords) {
  const out = [...(preserved || [])]
  for (const kw of entityKeywords || []) {
    if (!out.includes(kw)) out.push(kw)
  }
  return out
}
