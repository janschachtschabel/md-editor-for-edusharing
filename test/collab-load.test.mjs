// Regression test for the reconnect-duplication bug (text and entity pills
// appearing twice): a rebuilt Y.Doc is structurally NEW to Yjs even with
// identical text, so merging it into a still-live client doc duplicates every
// insertion. The fix keeps a Yjs snapshot per document across unload/reload
// (docSnapshots in server/collab.js) and restores it instead of rebuilding.
//
// The critical gap this test pins down: Hocuspocus only flushes
// onStoreDocument on the last disconnect when a store is pending — a document
// unloaded with NO changes since load never reached persistDocument, so the
// snapshot must be taken at LOAD time, not only at store time.
//
// Drives the real onLoadDocument/afterUnloadDocument hooks against a stubbed
// fetch (mock edu-sharing metadata) and simulates Hocuspocus's merge
// (applyUpdate(document, encodeStateAsUpdate(loadedDocument)) — see dist).
import * as Y from 'yjs'

let fail = 0
function check(name, ok, extra = '') {
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : `→ ${extra}`)
}

// --- stub edu-sharing: metadata with compendium text + keywords ---------------
const MARKDOWN = '# Weimar\n\nWeimar ist schön. Ein Absatz mit **Fett**.'
const HEADERS = { get: (k) => (k === 'content-type' ? 'application/json' : null) }
globalThis.fetch = async (url) => {
  if (String(url).includes('/metadata')) {
    return {
      ok: true,
      status: 200,
      headers: HEADERS,
      json: async () => ({
        node: {
          ref: { id: 'x' }, type: 'ccm:map', name: 'Test', title: 'Test',
          access: ['Read'],
          properties: {
            'ccm:oeh_collection_compendium_text': [MARKDOWN],
            'cclom:general_keyword': ['Optik', 'Weimar (Stadt)'],
          },
        },
      }),
    }
  }
  return { ok: false, status: 404, headers: HEADERS, json: async () => ({}) }
}

const { hocuspocus } = await import('../server/collab.js')
const cfg = hocuspocus.configuration
const documentName = '00000000-0000-4000-8000-00000000000a'

/** Simulate Hocuspocus applying the hook result to its served document. */
async function loadInto(serverDoc) {
  const ret = await cfg.onLoadDocument({ documentName, document: serverDoc })
  if (ret instanceof Y.Doc && ret !== serverDoc) {
    Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(ret))
  }
  return serverDoc
}

// --- 1st load: server builds the doc, a client syncs it -----------------------
const serverDoc1 = await loadInto(new Y.Doc())
const clientDoc = new Y.Doc() // stays "live" across the server unload (brief WS drop)
Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(serverDoc1))

const textBefore = clientDoc.getXmlFragment('default').toString()
const pillsBefore = clientDoc.getArray('annotations').length
check('initial load has content', textBefore.includes('Weimar ist sch'))
check('initial load seeds the entity annotation', pillsBefore === 1)

// --- unload WITHOUT any changes (persistDocument never ran) -------------------
await cfg.afterUnloadDocument({ documentName })

// --- 2nd load (reconnect): must merge cleanly into the live client doc --------
const serverDoc2 = await loadInto(new Y.Doc())
Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(serverDoc2))

check('no duplicated text after unload/reload with a live client',
  clientDoc.getXmlFragment('default').toString() === textBefore,
  `len ${textBefore.length} → ${clientDoc.getXmlFragment('default').toString().length}`)
check('no duplicated entity pills after unload/reload',
  clientDoc.getArray('annotations').length === pillsBefore,
  `pills ${pillsBefore} → ${clientDoc.getArray('annotations').length}`)

// And the server side itself must be identical, not just the client merge
check('reloaded server doc equals the first load (same Yjs state)',
  serverDoc2.getXmlFragment('default').toString() === serverDoc1.getXmlFragment('default').toString())

process.exit(fail ? 1 : 0)
