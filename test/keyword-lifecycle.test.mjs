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
// Two anchor traps (audit KW-1) are baked into the text: a quote spanning a
// BOLD boundary ("Kartoffelhof Sonnental" with only "Kartoffelhof" bold) and
// a plain term that turndown ESCAPES in markdown ("snake_case_name" →
// "snake\_case\_name"). Both are anchored in the PLAIN text and must survive
// every save — the old markdown-source anchor check silently dropped them.
const MARKDOWN = '# Kartoffel\n\nDie Kartoffel wurde in Weimar untersucht.\n\nDer **Kartoffelhof** Sonnental liegt bei Erfurt.\n\nDie Variable snake_case_name ist wichtig.'
const nodeProps = {
  'ccm:oeh_collection_compendium_text': [MARKDOWN],
  'cm:description': ['Merkur ist der innerste Planet.'],
  // Repo order deliberately interleaves plain and entity keywords: a pure
  // reordering must never count as a keyword change (spurious writes).
  'cclom:general_keyword': [
    'Optik', 'Weimar (Stadt)', 'Mechanik', 'Merkur (Planet)', 'Pluto (Planet)',
    'Kartoffelhof Sonnental (Ort)', 'snake_case_name (Fachbegriff)',
  ],
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
  JSON.stringify(quotes()) === JSON.stringify(['Kartoffelhof Sonnental', 'Merkur', 'Pluto', 'Weimar', 'snake_case_name']), quotes())

// --- 1) first save: stale entity is auto-removed, cross-field entity survives --
await persistDocument(documentName, serverDoc, true)
{
  const kw = lastKeywordWrite()
  check('cleanup save: plain keywords survive', kw.values.includes('Optik') && kw.values.includes('Mechanik'), kw.values)
  check('cleanup save: anchored entity survives (Weimar in compendium)', kw.values.includes('Weimar (Stadt)'), kw.values)
  check('cleanup save: CROSS-FIELD entity survives (Merkur in description)', kw.values.includes('Merkur (Planet)'), kw.values)
  // KW-1 regressions: anchoring must run against PLAIN text, not markdown source
  check('KW-1: quote spanning a BOLD boundary survives the save',
    kw.values.includes('Kartoffelhof Sonnental (Ort)'), kw.values)
  check('KW-1: quote with markdown-escaped chars (snake_case_name) survives the save',
    kw.values.includes('snake_case_name (Fachbegriff)'), kw.values)
  check('cleanup save: entity anchored NOWHERE is auto-removed (Pluto)', !kw.values.includes('Pluto (Planet)'), kw.values)
  check('cleanup save: only the Pluto pill is pruned',
    JSON.stringify(quotes()) === JSON.stringify(['Kartoffelhof Sonnental', 'Merkur', 'Weimar', 'snake_case_name']), quotes())
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
  { id: 't2', quote: 'Mondbasis', occurrence: 1, type: 'Ort' },     // anchored nowhere → auto-removed
])
await persistDocument(documentName, serverDoc, true)
{
  const kw = lastKeywordWrite()
  check('tag + save: anchored new entity written', kw.values.includes('Kartoffel (Thema)'), kw.values)
  check('tag + save: unanchored tag NOT written (semantic statement would be false)',
    !kw.values.includes('Mondbasis (Ort)'), kw.values)
  check('tag + save: unanchored pill pruned automatically',
    JSON.stringify(quotes()) === JSON.stringify(['Kartoffel', 'Kartoffelhof Sonnental', 'Merkur', 'Weimar', 'snake_case_name']), quotes())
}

// --- 4) unload + reload + "alle Pillen löschen" ---------------------------------
await cfg.afterUnloadDocument({ documentName })
docAuth.set(documentName, 'Basic dGVzdDpwdw==')
const doc2 = new Y.Doc()
const ret2 = await cfg.onLoadDocument({ documentName, document: doc2 })
const serverDoc2 = ret2 instanceof Y.Doc ? ret2 : doc2
const annotations2 = serverDoc2.getArray('annotations')
check('reload: all surviving entities are pills again',
  annotations2.toArray().map((a) => a.quote).sort().join(',')
    === 'Kartoffel,Kartoffelhof Sonnental,Merkur,Weimar,snake_case_name')

serverDoc2.transact(() => annotations2.delete(0, annotations2.length)) // „alle ✕"
await persistDocument(documentName, serverDoc2, true)
check('delete ALL pills + save: only plain keywords remain on the node',
  JSON.stringify([...nodeProps['cclom:general_keyword']].sort())
    === JSON.stringify(['Mechanik', 'Optik']), nodeProps['cclom:general_keyword'])

const before = propertyWrites.length
await persistDocument(documentName, serverDoc2, true)
check('save without changes afterwards: still a no-op', propertyWrites.length === before,
  propertyWrites.slice(before))

// --- 5) L-2: the server prune must not schedule a follow-up store cycle ----------
// The prune transaction runs with hocuspocus' skip-store LocalTransactionOrigin,
// and onChange must not re-mark the document dirty for it — otherwise every
// pruning save is followed by a pointless noop-save 15 s later.
{
  const { shouldSkipStoreHooks } = await import('@hocuspocus/server')
  const { pruneUnanchoredAnnotations } = await import('../server/keyword-sync.js')
  const { docState } = await import('../server/collab.js')

  const pruneDoc = new Y.Doc()
  pruneDoc.getArray('annotations').push([{ id: 'x', quote: 'nirgends', occurrence: 1, type: 'Ort' }])
  let seenOrigin = 'no-update-fired'
  pruneDoc.on('update', (_u, origin) => { seenOrigin = origin })
  const pruned = pruneUnanchoredAnnotations(pruneDoc, 'ganz anderer text')
  check('prune removes the unanchored pill', pruned === 1)
  check('prune transaction carries a skip-store origin (no follow-up store cycle)',
    shouldSkipStoreHooks(seenOrigin), seenOrigin)

  docState.set('origin-doc', { dirty: false })
  await cfg.onChange({ documentName: 'origin-doc', transactionOrigin: seenOrigin })
  check('onChange ignores the prune origin (stays clean)',
    docState.get('origin-doc').dirty === false, docState.get('origin-doc'))
  await cfg.onChange({ documentName: 'origin-doc', transactionOrigin: { source: 'connection' } })
  check('onChange still marks user edits dirty',
    docState.get('origin-doc').dirty === true, docState.get('origin-doc'))
  docState.delete('origin-doc')
}

// --- 5b) duplicate pills: the save cycle must dedupe the shared array -------------
// Duplicates can enter the Y.Array from outside the guarded paths (e.g. a
// server restart rebuilding+seeding against a still-live client): every
// entity may exist ONCE — persistence heals the array as maintenance.
{
  nodeProps['ccm:oeh_collection_compendium_text'] = ['Die Kartoffel wächst in Weimar.']
  nodeProps['cm:description'] = ['']
  nodeProps['cclom:general_keyword'] = ['Kartoffel (Thema)']
  const nameD = '00000000-0000-4000-8000-00000000000d'
  docAuth.set(nameD, 'Basic dGVzdDpwdw==')
  const dD = new Y.Doc()
  const retD = await cfg.onLoadDocument({ documentName: nameD, document: dD })
  const sdD = retD instanceof Y.Doc ? retD : dD
  const arrD = sdD.getArray('annotations')
  // inject the duplication the user observed: same entity again, fresh id
  arrD.push([{ id: 'dup-1', quote: 'Kartoffel', occurrence: 1, type: 'Thema' },
    { id: 'dup-2', quote: 'Weimar', occurrence: 1, type: 'Ort' },
    { id: 'dup-3', quote: 'Weimar', occurrence: 1, type: 'Ort' }])
  check('setup: array contains duplicates', arrD.length === 4)
  await persistDocument(nameD, sdD, true)
  const quotesD = arrD.toArray().map((a) => `${a.quote}|${a.type}`).sort()
  check('save dedupes the pills (each entity once)',
    JSON.stringify(quotesD) === JSON.stringify(['Kartoffel|Thema', 'Weimar|Ort']), quotesD)
  check('repo keywords stay clean after dedupe',
    JSON.stringify([...nodeProps['cclom:general_keyword']].sort())
    === JSON.stringify(['Kartoffel (Thema)', 'Weimar (Ort)']), nodeProps['cclom:general_keyword'])
  await cfg.afterUnloadDocument({ documentName: nameD })
}

// --- 6) derived blocks refresh on save: TOC + glossary keep themselves current ---
// Both blocks are opt-in content (inserted once via their buttons); every
// SAVE brings them up to date server-side so no stale directory persists.
{
  const STALE = `::: inhaltsverzeichnis
## Inhaltsverzeichnis

- [Veraltet](#veraltet)
:::

# Neue Überschrift

Der Merkur ist klein.

::: glossar
## Glossar

- **Veraltet** (Ort)
:::`
  nodeProps['ccm:oeh_collection_compendium_text'] = [STALE]
  nodeProps['cm:description'] = ['']
  nodeProps['cclom:general_keyword'] = ['Merkur (Planet)']
  const name6 = '00000000-0000-4000-8000-00000000000c'
  docAuth.set(name6, 'Basic dGVzdDpwdw==')
  const d6 = new Y.Doc()
  const ret6 = await cfg.onLoadDocument({ documentName: name6, document: d6 })
  const sd6 = ret6 instanceof Y.Doc ? ret6 : d6
  await persistDocument(name6, sd6, true)
  const saved = nodeProps['ccm:oeh_collection_compendium_text'][0]
  // marked percent-encodes umlauts in hrefs on the persist round trip — both
  // forms resolve identically (browsers + the editor's click handler decode)
  check('save refreshes the TOC (current heading linked)',
    /\[Neue Überschrift\]\(#neue-(überschrift|%C3%BCberschrift)\)/.test(saved), saved)
  check('save refreshes the TOC (stale entry gone)', !saved.includes('#veraltet'), saved)
  check('save refreshes the glossary (anchored entity listed)',
    /- +\*\*Merkur\*\* \(Planet\)/.test(saved), saved)
  check('save refreshes the glossary (stale entry gone)', !saved.includes('Veraltet'), saved)
  const before6 = propertyWrites.length
  await persistDocument(name6, sd6, true)
  check('refreshed state is stable (second save is a no-op)',
    propertyWrites.length === before6, propertyWrites.slice(before6))
  await cfg.afterUnloadDocument({ documentName: name6 })
}

// --- 6b) TOC refresh escapes markdown link syntax in heading texts ----------------
{
  nodeProps['ccm:oeh_collection_compendium_text'] = [
    '::: inhaltsverzeichnis\n## Inhaltsverzeichnis\n\n- [alt](#alt)\n:::\n\n# Kapitel [1] Start\n\nInhalt.']
  nodeProps['cm:description'] = ['']
  nodeProps['cclom:general_keyword'] = []
  const nameE = '00000000-0000-4000-8000-00000000000e'
  docAuth.set(nameE, 'Basic dGVzdDpwdw==')
  const dE = new Y.Doc()
  const retE = await cfg.onLoadDocument({ documentName: nameE, document: dE })
  await persistDocument(nameE, retE instanceof Y.Doc ? retE : dE, true)
  const savedE = nodeProps['ccm:oeh_collection_compendium_text'][0]
  check('TOC refresh escapes [ ] in heading link texts (no broken markdown)',
    /\[Kapitel \\\[1\\\] Start\]\(#/.test(savedE), savedE.split('\n').slice(0, 5))
  await cfg.afterUnloadDocument({ documentName: nameE })
}

// --- 7) concurrent saves are serialized (no false verification alarm) -------------
// Two overlapping persistDocument runs (manual save + debounced store + error
// retry all call it) used to interleave at the repo: run A wrote, run B wrote,
// then A's read-back saw B's newer state and broadcast a false
// "Repo hat die Änderung nicht übernommen" save-error to every client.
{
  nodeProps['ccm:oeh_collection_compendium_text'] = ['Sonnental liegt bei Erfurt.']
  nodeProps['cm:description'] = ['']
  nodeProps['cclom:general_keyword'] = []
  const name7 = '00000000-0000-4000-8000-00000000000f'
  docAuth.set(name7, 'Basic dGVzdDpwdw==')
  const d7 = new Y.Doc()
  const ret7 = await cfg.onLoadDocument({ documentName: name7, document: d7 })
  const sd7 = ret7 instanceof Y.Doc ? ret7 : d7
  const events = []
  sd7.broadcastStateless = (s) => events.push(JSON.parse(s))
  // Save A (keyword change 1) and, while A is in flight, save B (change 2)
  sd7.getArray('annotations').push([{ id: 'r1', quote: 'Erfurt', occurrence: 1, type: 'Stadt' }])
  const pA = persistDocument(name7, sd7, true)
  sd7.getArray('annotations').push([{ id: 'r2', quote: 'Sonnental', occurrence: 1, type: 'Ort' }])
  const pB = persistDocument(name7, sd7, true)
  await Promise.all([pA, pB])
  check('concurrent saves produce no false verification alarm',
    !events.some((e) => e.event === 'save-error'), events.filter((e) => e.event === 'save-error'))
  check('concurrent saves persist the final state (both keywords)',
    nodeProps['cclom:general_keyword'].includes('Erfurt (Stadt)')
    && nodeProps['cclom:general_keyword'].includes('Sonnental (Ort)'), nodeProps['cclom:general_keyword'])
  await cfg.afterUnloadDocument({ documentName: name7 })
}

process.exit(fail ? 1 : 0)
