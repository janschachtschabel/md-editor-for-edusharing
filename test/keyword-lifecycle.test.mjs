// End-to-end keyword lifecycle over the REAL server persistence path.
//
// Semantic model under test:
//   - PLAIN keywords ("Optik", "Mechanik") are editorial — read, shown locked
//     in the UI, and written back byte-exact on every save. Never lost.
//   - "Name (Typ)" keywords are ENTITY STATEMENTS about the node's texts.
//     On save, only entities whose quote is anchored in the node's TEXTBASE
//     (current document text OR the node's other field — compendium and
//     description share ONE keyword list) are written; unanchored ones are
//     removed from the keywords AND their pills are pruned (a stale tag would
//     falsify the semantic statement).
//
// Drives the real onLoadDocument + persistDocument hooks against a STATEFUL
// fetch stub (a mock edu-sharing node whose properties are mutated by
// setProperty calls, so the read-back verification runs for real) and
// records every property write.
import * as Y from 'yjs'

let fail = 0
function check(name, ok, extra = '') {
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : `→ ${JSON.stringify(extra)}`)
}

// --- stateful mock edu-sharing node -------------------------------------------
// Compendium text anchors "Weimar" + "Kartoffel"; the DESCRIPTION field
// anchors "Merkur" (cross-field entity). "Pluto" is anchored NOWHERE.
const MARKDOWN = '# Kartoffel\n\nDie Kartoffel wurde in Weimar untersucht.'
const nodeProps = {
  'ccm:oeh_collection_compendium_text': [MARKDOWN],
  'cm:description': ['Merkur ist der innerste Planet.'],
  // Repo order deliberately interleaves plain and entity keywords: a pure
  // reordering must never count as a keyword change (spurious writes).
  'cclom:general_keyword': ['Optik', 'Weimar (Stadt)', 'Mechanik', 'Merkur (Planet)', 'Pluto (Planet)'],
}
const propertyWrites = [] // {property, values}

const HEADERS = { get: (k) => (k === 'content-type' ? 'application/json' : null) }
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url)
  if (u.includes('/property?property=')) {
    const property = decodeURIComponent(u.split('property=')[1])
    const values = JSON.parse(opts.body)
    propertyWrites.push({ property, values })
    nodeProps[property] = values
    return { ok: true, status: 200, headers: HEADERS, json: async () => ({}) }
  }
  if (u.includes('/metadata')) {
    return {
      ok: true, status: 200, headers: HEADERS,
      json: async () => ({
        node: {
          ref: { id: 'x' }, type: 'ccm:map', name: 'Test', title: 'Test',
          access: ['Read', 'Write'],
          properties: JSON.parse(JSON.stringify(nodeProps)),
        },
      }),
    }
  }
  return { ok: false, status: 404, headers: HEADERS, json: async () => ({}) }
}

const { hocuspocus, docAuth, persistDocument } = await import('../server/collab.js')
const cfg = hocuspocus.configuration
const documentName = '00000000-0000-4000-8000-00000000000b'
docAuth.set(documentName, 'Basic dGVzdDpwdw==') // write session for persistence

const doc = new Y.Doc()
const ret = await cfg.onLoadDocument({ documentName, document: doc })
const serverDoc = ret instanceof Y.Doc ? ret : doc
const annotations = serverDoc.getArray('annotations')
const quotes = () => annotations.toArray().map((a) => a.quote).sort()
const lastKeywordWrite = () => propertyWrites.filter((w) => w.property === 'cclom:general_keyword').at(-1)

check('load: every pattern keyword becomes a pill (anchored or orphan)',
  JSON.stringify(quotes()) === JSON.stringify(['Merkur', 'Pluto', 'Weimar']), quotes())

// --- 1) first save: stale entity is auto-removed, cross-field entity survives --
await persistDocument(documentName, serverDoc, true)
{
  const kw = lastKeywordWrite()
  check('cleanup save: plain keywords survive', kw.values.includes('Optik') && kw.values.includes('Mechanik'), kw.values)
  check('cleanup save: anchored entity survives (Weimar in compendium)', kw.values.includes('Weimar (Stadt)'), kw.values)
  check('cleanup save: CROSS-FIELD entity survives (Merkur in description)', kw.values.includes('Merkur (Planet)'), kw.values)
  check('cleanup save: entity anchored NOWHERE is auto-removed (Pluto)', !kw.values.includes('Pluto (Planet)'), kw.values)
  check('cleanup save: Pluto pill pruned, cross-field orphan pill kept',
    JSON.stringify(quotes()) === JSON.stringify(['Merkur', 'Weimar']), quotes())
}

// --- 2) save again without changes: pure no-op ---------------------------------
{
  const before = propertyWrites.length
  await persistDocument(documentName, serverDoc, true)
  check('second save is a no-op (no spurious writes)', propertyWrites.length === before,
    propertyWrites.slice(before))
}

// --- 3) user tags an entity, then the anchoring text "disappears" ---------------
// Simulated by pushing a pill whose quote is in NO text (same effect as
// deleting the passage after tagging): the save must drop keyword + pill.
annotations.push([
  { id: 't1', quote: 'Kartoffel', occurrence: 1, type: 'Thema' },   // anchored → stays
  { id: 't2', quote: 'Sonnental', occurrence: 1, type: 'Ort' },     // anchored nowhere → auto-removed
])
await persistDocument(documentName, serverDoc, true)
{
  const kw = lastKeywordWrite()
  check('tag + save: anchored new entity written', kw.values.includes('Kartoffel (Thema)'), kw.values)
  check('tag + save: unanchored tag NOT written (semantic statement would be false)',
    !kw.values.includes('Sonnental (Ort)'), kw.values)
  check('tag + save: unanchored pill pruned automatically',
    JSON.stringify(quotes()) === JSON.stringify(['Kartoffel', 'Merkur', 'Weimar']), quotes())
}

// --- 4) unload + reload + "alle Pillen löschen" ---------------------------------
await cfg.afterUnloadDocument({ documentName })
docAuth.set(documentName, 'Basic dGVzdDpwdw==')
const doc2 = new Y.Doc()
const ret2 = await cfg.onLoadDocument({ documentName, document: doc2 })
const serverDoc2 = ret2 instanceof Y.Doc ? ret2 : doc2
const annotations2 = serverDoc2.getArray('annotations')
check('reload: pills = the three surviving entities',
  annotations2.toArray().map((a) => a.quote).sort().join(',') === 'Kartoffel,Merkur,Weimar')

serverDoc2.transact(() => annotations2.delete(0, annotations2.length)) // „alle ✕"
await persistDocument(documentName, serverDoc2, true)
check('delete ALL pills + save: only plain keywords remain on the node',
  JSON.stringify([...nodeProps['cclom:general_keyword']].sort())
    === JSON.stringify(['Mechanik', 'Optik']), nodeProps['cclom:general_keyword'])

const before = propertyWrites.length
await persistDocument(documentName, serverDoc2, true)
check('save without changes afterwards: still a no-op', propertyWrites.length === before,
  propertyWrites.slice(before))

process.exit(fail ? 1 : 0)
