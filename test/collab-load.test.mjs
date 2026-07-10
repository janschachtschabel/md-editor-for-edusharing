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

// --- logout terminates EVERY connection of the session -------------------------
// Reported: after logging out, the user's presence lingered — a second tab
// using the same session token stayed connected (and could reconnect, since
// invalid tokens were silently downgraded to read-only instead of rejected).
{
  const { closeSessionConnections } = await import('../server/collab.js')

  // (a) presenting an INVALID (non-anonymous) token must be rejected outright
  let rejected = false
  try {
    await cfg.onAuthenticate({ token: 'revoked-or-expired', documentName, connectionConfig: {} })
  } catch { rejected = true }
  check('invalid session token is rejected (no silent read-only downgrade)', rejected)

  // (b) anonymous connections keep working (read-only viewing stays possible)
  const anonCfg = {}
  await cfg.onAuthenticate({ token: 'anonymous', documentName, connectionConfig: anonCfg })
  check('anonymous connection still allowed', true)

  // (c) revoking a session closes ALL its registered WS connections
  const closed = []
  const fakeConn = (id) => ({ close: (ev) => closed.push({ id, ...ev }) })
  await cfg.connected({ context: { sessionToken: 'tok-1' }, socketId: 's1', connection: fakeConn('s1') })
  await cfg.connected({ context: { sessionToken: 'tok-1' }, socketId: 's2', connection: fakeConn('s2') })
  closeSessionConnections('tok-1')
  check('all connections of the session are closed on logout',
    closed.length === 2 && closed.every((c) => c.code === 4403), closed)
  closeSessionConnections('tok-1')
  check('registry is cleared (second call closes nothing)', closed.length === 2)

  // (d) a normal disconnect unregisters the connection first
  await cfg.connected({ context: { sessionToken: 'tok-2' }, socketId: 's3', connection: fakeConn('s3') })
  await cfg.onDisconnect({ context: { sessionToken: 'tok-2' }, socketId: 's3' })
  closeSessionConnections('tok-2')
  check('disconnected connections are not closed again', closed.length === 2)
}

process.exit(fail ? 1 : 0)
