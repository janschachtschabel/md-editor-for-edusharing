// Unit tests for the pure semantic-annotation logic: keyword serialization
// ("Name (Typ)"), quote→offset resolution, overlap validation (nested and
// identical allowed, crossing rejected) and the keyword⇄annotation roundtrip.
import {
  annotationsToKeywords, findAllQuoteRanges, findQuoteRange, formatKeyword, isCrossing,
  keywordsToAnnotations, occurrenceOfIndex, parseKeyword, resolveAnnotations,
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

// --- overlap validation -------------------------------------------------------
const inst = { start: 0, end: 18 }   // "Universität Weimar"
const ort = { start: 12, end: 22 }   // "Weimar ist" (crosses)
const nested = { start: 12, end: 18 } // "Weimar" (nested)
check('crossing ranges are detected', isCrossing(inst, ort) === true)
check('nested ranges are allowed', isCrossing(inst, nested) === false)
check('identical ranges are allowed', isCrossing(inst, { ...inst }) === false)
check('disjoint ranges are allowed', isCrossing({ start: 0, end: 5 }, { start: 10, end: 12 }) === false)

// --- keywords → annotations (load path) ---------------------------------------
const kws = ['Optik', 'Weimar (Stadt)', 'Erfurt (Stadt)', 'huygenssches Prinzip (Fachbegriff)']
const doc = 'Das huygenssche Prinzip wurde in Weimar diskutiert. huygenssches Prinzip eben.'
const seeded = keywordsToAnnotations(kws, doc)
check('keywords without pattern are skipped', !seeded.some((a) => a.quote === 'Optik'))
check('quote not found in text → skipped (Erfurt)', !seeded.some((a) => a.quote === 'Erfurt'))
check('found entities are seeded with type',
  seeded.length === 2 && seeded.every((a) => a.id && a.occurrence === 1)
  && seeded.some((a) => a.quote === 'Weimar' && a.type === 'Stadt'))

// --- annotations → keywords (save path) ----------------------------------------
const anns = [
  { id: '1', quote: 'Weimar', occurrence: 1, type: 'Stadt' },
  { id: '2', quote: 'Weimar', occurrence: 2, type: 'Stadt' }, // duplicate entity
  { id: '3', quote: 'Marie Curie', occurrence: 1, type: 'Person' },
]
const merged = annotationsToKeywords(anns, ['Optik', 'Weimar (Stadt)'])
check('plain keywords are preserved', merged.includes('Optik'))
check('entity keywords are deduplicated',
  merged.filter((k) => k === 'Weimar (Stadt)').length === 1)
check('new entities are appended', merged.includes('Marie Curie (Person)'))

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
