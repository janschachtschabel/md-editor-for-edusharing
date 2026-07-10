// End-to-end keyword lifecycle over the REAL server persistence path:
// pre-existing plain keywords ("Optik", "Mechanik") and parenthesized
// non-entity keywords ("Merkur (Planet)", word absent from the text) must
// survive every save while editor entities are added and removed.
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
const MARKDOWN = '# Kartoffel\n\nDie Kartoffel wurde in Weimar untersucht.'
const nodeProps = {
  'ccm:oeh_collection_compendium_text': [MARKDOWN],
  // Repo order deliberately puts the entity keyword in the MIDDLE: a pure
  // reordering must never count as a keyword change (spurious writes).
  'cclom:general_keyword': ['Optik', 'Weimar (Stadt)', 'Mechanik', 'Merkur (Planet)'],
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

// New semantics: EVERY "Name (Typ)" keyword becomes a pill — "Weimar (Stadt)"
// anchored, "Merkur (Planet)" (word absent) as an ORPHAN pill. Plain keywords
// ("Optik", "Mechanik") never become pills.
check('load: both pattern keywords become pills (Weimar anchored, Merkur orphan)',
  annotations.length === 2
  && annotations.toArray().some((a) => a.quote === 'Weimar' && a.type === 'Stadt')
  && annotations.toArray().some((a) => a.quote === 'Merkur' && a.type === 'Planet'))

// --- 1) save with NO changes: must be a complete no-op ------------------------
// (merged keyword order differs from repo order — set-equality must win)
await persistDocument(documentName, serverDoc, true)
check('no-op save writes nothing (no spurious keyword reorder write)',
  propertyWrites.length === 0, propertyWrites)

// --- 2) add an entity: plain + foreign keywords must ride along ---------------
annotations.push([{ id: 't1', quote: 'Kartoffel', occurrence: 1, type: 'Thema' }])
await persistDocument(documentName, serverDoc, true)
{
  const kw = propertyWrites.filter((w) => w.property === 'cclom:general_keyword').at(-1)
  check('add entity: exactly one keyword write', Boolean(kw) && propertyWrites.length === 1, propertyWrites)
  for (const expect of ['Optik', 'Mechanik', 'Merkur (Planet)', 'Weimar (Stadt)', 'Kartoffel (Thema)']) {
    check(`add entity: "${expect}" present`, kw.values.includes(expect), kw.values)
  }
  check('add entity: no unexpected extras', kw.values.length === 5, kw.values)
}

// --- 3) delete SPECIFIC pills: Weimar + Kartoffel, keep the Merkur orphan ------
serverDoc.transact(() => {
  const arr = annotations.toArray()
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].quote === 'Weimar' || arr[i].quote === 'Kartoffel') annotations.delete(i, 1)
  }
})
await persistDocument(documentName, serverDoc, true)
{
  const kw = propertyWrites.filter((w) => w.property === 'cclom:general_keyword').at(-1)
  check('remove pills: plain "Optik" survives', kw.values.includes('Optik'), kw.values)
  check('remove pills: plain "Mechanik" survives', kw.values.includes('Mechanik'), kw.values)
  check('remove pills: kept ORPHAN pill "Merkur (Planet)" survives', kw.values.includes('Merkur (Planet)'), kw.values)
  check('remove pills: "Weimar (Stadt)" removed (pill deleted)', !kw.values.includes('Weimar (Stadt)'), kw.values)
  check('remove pills: "Kartoffel (Thema)" removed (pill deleted)', !kw.values.includes('Kartoffel (Thema)'), kw.values)
}

// --- 4) unload + reload: orphan comes back as a pill, then "delete ALL pills" ---
// This is the reported stuck-keywords case: after clearing every pill and
// saving, NO pattern keyword may stick to the node — only plain ones remain.
await cfg.afterUnloadDocument({ documentName })
docAuth.set(documentName, 'Basic dGVzdDpwdw==')
const doc2 = new Y.Doc()
const ret2 = await cfg.onLoadDocument({ documentName, document: doc2 })
const serverDoc2 = ret2 instanceof Y.Doc ? ret2 : doc2
const annotations2 = serverDoc2.getArray('annotations')
check('reload: the kept orphan is a pill again (deletable, not stuck)',
  annotations2.length === 1 && annotations2.get(0).quote === 'Merkur')

serverDoc2.transact(() => annotations2.delete(0, annotations2.length)) // "alle Pillen löschen"
await persistDocument(documentName, serverDoc2, true)
check('delete ALL pills + save: no pattern keyword sticks to the node',
  JSON.stringify([...nodeProps['cclom:general_keyword']].sort())
    === JSON.stringify(['Mechanik', 'Optik']), nodeProps['cclom:general_keyword'])

const before = propertyWrites.length
await persistDocument(documentName, serverDoc2, true)
check('save without changes afterwards: still a no-op', propertyWrites.length === before,
  propertyWrites.slice(before))

process.exit(fail ? 1 : 0)
