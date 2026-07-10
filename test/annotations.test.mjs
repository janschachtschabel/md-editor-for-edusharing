// Unit tests for the pure semantic-annotation logic: keyword serialization
// ("Name (Typ)"), quote→offset resolution, overlap validation (nested and
// identical allowed, crossing rejected) and the keyword⇄annotation roundtrip.
import {
  findAllQuoteRanges, findQuoteRange, formatKeyword, isCrossing, isValidQuote,
  keywordsToAnnotations, mergeKeywords, MAX_QUOTE_LENGTH, occurrenceOfIndex, parseKeyword,
  preservedKeywords, resolveAnnotations, serializeEntityKeywords,
} from '../src/annotations.js'

let fail = 0
function check(name, ok, extra = '') {
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : `→ ${extra}`)
}

// --- keyword serialization ---------------------------------------------------
check('formatKeyword → "Name (Typ)"',
  formatKeyword({ quote: 'Weimar', type: 'Stadt' }) === 'Weimar (Stadt)')
check('parseKeyword reads back name and type',
  JSON.stringify(parseKeyword('Weimar (Stadt)')) === JSON.stringify({ quote: 'Weimar', type: 'Stadt' }))
check('parseKeyword: name may contain parentheses',
  JSON.stringify(parseKeyword('Willy Brandt (SPD) (Person)')) === JSON.stringify({ quote: 'Willy Brandt (SPD)', type: 'Person' }))
check('parseKeyword: plain keyword without pattern → null',
  parseKeyword('Optik') === null)
check('parseKeyword: empty type → null', parseKeyword('Weimar ()') === null)
check('roundtrip format→parse',
  JSON.stringify(parseKeyword(formatKeyword({ quote: 'huygenssches Prinzip', type: 'Fachbegriff' })))
    === JSON.stringify({ quote: 'huygenssches Prinzip', type: 'Fachbegriff' }))

// --- quote → offsets ----------------------------------------------------------
const TEXT = 'Weimar ist schön. Weimar liegt in Thüringen.'
check('findQuoteRange: first occurrence',
  JSON.stringify(findQuoteRange(TEXT, 'Weimar')) === JSON.stringify({ start: 0, end: 6 }))
check('findQuoteRange: second occurrence',
  JSON.stringify(findQuoteRange(TEXT, 'Weimar', 2)) === JSON.stringify({ start: 18, end: 24 }))
check('findQuoteRange: missing occurrence → null', findQuoteRange(TEXT, 'Weimar', 3) === null)
check('findQuoteRange: hallucinated quote → null', findQuoteRange(TEXT, 'Erfurt') === null)
check('occurrenceOfIndex: start index → occurrence number',
  occurrenceOfIndex(TEXT, 'Weimar', 18) === 2 && occurrenceOfIndex(TEXT, 'Weimar', 0) === 1)
check('findAllQuoteRanges: every occurrence, in order',
  JSON.stringify(findAllQuoteRanges(TEXT, 'Weimar'))
    === JSON.stringify([{ start: 0, end: 6 }, { start: 18, end: 24 }]))
check('findAllQuoteRanges: no match → empty array', JSON.stringify(findAllQuoteRanges(TEXT, 'Erfurt')) === '[]')
check('findAllQuoteRanges: empty quote → empty array', JSON.stringify(findAllQuoteRanges(TEXT, '')) === '[]')

// --- quote length guard (audit L-1: unbounded quotes become oversized
// "Name (Typ)" keywords with no client-side feedback before the round trip
// to edu-sharing) ---------------------------------------------------------
check('normal-length quote is valid', isValidQuote('Weimar'))
check('empty quote is invalid', isValidQuote('') === false)
// F-T6: block-spanning quotes must be rejected in EVERY path (the text index
// joins blocks with '\n', so a multi-block quote could otherwise anchor
// across a block boundary via the programmatic add() path)
check('quote spanning blocks (contains \\n) is invalid', isValidQuote('foo\nbar') === false)
check(`quote at exactly ${MAX_QUOTE_LENGTH} chars is valid`, isValidQuote('a'.repeat(MAX_QUOTE_LENGTH)))
check(`quote over ${MAX_QUOTE_LENGTH} chars is invalid`, isValidQuote('a'.repeat(MAX_QUOTE_LENGTH + 1)) === false)

// --- overlap validation -------------------------------------------------------
const inst = { start: 0, end: 18 }   // "Universität Weimar"
const ort = { start: 12, end: 22 }   // "Weimar ist" (crosses)
const nested = { start: 12, end: 18 } // "Weimar" (nested)
check('crossing ranges are detected', isCrossing(inst, ort) === true)
check('nested ranges are allowed', isCrossing(inst, nested) === false)
check('identical ranges are allowed', isCrossing(inst, { ...inst }) === false)
check('disjoint ranges are allowed', isCrossing({ start: 0, end: 5 }, { start: 10, end: 12 }) === false)

// --- keywords → annotations (load path) ---------------------------------------
// EVERY "Name (Typ)" keyword is editor-managed: those whose quote is verbatim
// in the text anchor normally; those WITHOUT a text anchor become ORPHAN pills
// (visible, deletable, and re-serialized on save unless deleted — no silent
// loss, no un-deletable leftovers). Only plain keywords stay untouched.
const kws = ['Optik', 'Weimar (Stadt)', 'Merkur (Planet)', 'huygenssches Prinzip (Fachbegriff)']
const doc = 'Das huygenssche Prinzip wurde in Weimar diskutiert. huygenssches Prinzip eben.'
const { annotations: seeded, consumed } = keywordsToAnnotations(kws, doc)
check('keywords without pattern are skipped', !seeded.some((a) => a.quote === 'Optik'))
check('parenthesized keyword whose word is absent → ORPHAN pill (Merkur)',
  seeded.some((a) => a.quote === 'Merkur' && a.type === 'Planet'))
check('orphan pill resolves with null range',
  resolveAnnotations(seeded, doc).find((a) => a.quote === 'Merkur')?.start === null)
check('anchored entities are seeded with type',
  seeded.length === 3 && seeded.every((a) => a.id && a.occurrence === 1)
  && seeded.some((a) => a.quote === 'Weimar' && a.type === 'Stadt'))
check('consumed = every pattern keyword (incl. the orphan)',
  JSON.stringify([...consumed].sort())
    === JSON.stringify(['Merkur (Planet)', 'Weimar (Stadt)', 'huygenssches Prinzip (Fachbegriff)'].sort()))

// exact duplicate entity keywords in the repo list must not create two pills
{
  const dup = keywordsToAnnotations(['Weimar (Stadt)', 'Weimar (Stadt)'], 'Weimar ist schön.')
  check('duplicate entity keyword → one pill, consumed once',
    dup.annotations.length === 1 && dup.consumed.length === 1)
}

// preservedKeywords = ONLY plain keywords (everything else is editor-managed)
const preserved = preservedKeywords(kws, consumed)
check('preserved keeps plain keyword (Optik)', preserved.includes('Optik'))
check('preserved is ONLY the plain keywords', JSON.stringify(preserved) === JSON.stringify(['Optik']))
check('orphan keyword round-trips via its pill (no loss while not deleted)',
  mergeKeywords(preserved, serializeEntityKeywords(seeded)).includes('Merkur (Planet)'))

// --- annotations → entity keywords (save path) --------------------------------
const anns = [
  { id: '1', quote: 'Weimar', occurrence: 1, type: 'Stadt' },
  { id: '2', quote: 'Weimar', occurrence: 2, type: 'Stadt' }, // duplicate entity
  { id: '3', quote: 'Marie Curie', occurrence: 1, type: 'Person' },
]
const entity = serializeEntityKeywords(anns)
check('entity keywords are deduplicated', entity.filter((k) => k === 'Weimar (Stadt)').length === 1)
check('every annotation type is serialized', entity.includes('Marie Curie (Person)'))

// mergeKeywords: preserved (untouched) + current entities, deduplicated
const finalList = mergeKeywords(preserved, entity)
check('merge keeps preserved plain keyword', finalList.includes('Optik'))
check('merge adds current entities', finalList.includes('Marie Curie (Person)'))
check('merge has no duplicates', new Set(finalList).size === finalList.length)

// --- F-T1 regression: full load→edit→save cycle preserves pre-existing metadata
// A parenthesized keyword "Merkur (Planet)" whose "Merkur" is NOT in the text
// must survive a save, even though the user only edited text (no tagging) —
// nowadays it survives as an ORPHAN pill that re-serializes on save.
{
  const repoKeywords = ['Klimawandel', 'Merkur (Planet)']
  const text = 'Ein Text ganz ohne den Planeten.'
  const { annotations, consumed } = keywordsToAnnotations(repoKeywords, text)
  const saved = mergeKeywords(preservedKeywords(repoKeywords, consumed), serializeEntityKeywords(annotations))
  check('F-T1: pre-existing "Merkur (Planet)" survives a save it was never part of',
    saved.includes('Merkur (Planet)') && saved.includes('Klimawandel'))
}

// --- resolveAnnotations ---------------------------------------------------------
const resolved = resolveAnnotations([
  { id: 'a', quote: 'Weimar', occurrence: 2, type: 'Stadt' },
  { id: 'b', quote: 'Erfurt', occurrence: 1, type: 'Stadt' },
], TEXT)
check('resolve attaches offsets where the quote is found',
  resolved.find((a) => a.id === 'a')?.start === 18 && resolved.find((a) => a.id === 'a')?.end === 24)
check('resolve marks unresolvable annotations with null range',
  resolved.find((a) => a.id === 'b')?.start === null)

process.exit(fail ? 1 : 0)
