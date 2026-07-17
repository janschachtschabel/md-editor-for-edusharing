// Server-side building blocks for image child-IOs (server/images.js) and
// node comments (server/edu-sharing-api.js) against a mocked edu-sharing:
// child-IO create/upload/list/cleanup (prefix guard!) and the comment API
// incl. its Content-Type trap (415 unless application/json with RAW bytes).
let fail = 0
function check(name, ok, extra = '') {
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : `→ ${JSON.stringify(extra)}`)
}

const calls = []
const children = [
  { ref: { id: 'img-1' }, name: 'mdimg-foto.png', aspects: ['ccm:io_childobject'] },
  { ref: { id: 'img-2' }, name: 'mdimg-alt.png', aspects: ['ccm:io_childobject'] },
  { ref: { id: 'other' }, name: 'material.pdf', aspects: ['ccm:io_childobject'] },
]
const HEADERS = { get: (k) => (k === 'content-type' ? 'application/json' : null) }
let parentPublic = true // anonymous metadata probe succeeds ↔ parent is public
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url)
  calls.push({ url: u, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body })
  if (u.includes('/metadata')) {
    if (!opts.headers?.Authorization && !parentPublic) {
      return { ok: false, status: 403, headers: HEADERS, json: async () => ({}), text: async () => 'denied' }
    }
    return {
      ok: true, status: 200, headers: HEADERS,
      json: async () => ({ node: { ref: { id: 'parent-1' }, type: 'ccm:io', name: 'P', access: ['Read'], properties: {} } }),
    }
  }
  if (u.includes('/permissions')) {
    return { ok: true, status: 200, headers: HEADERS, json: async () => ({}) }
  }
  if (u.includes('/children') && (opts.method || 'GET') === 'POST') {
    return { ok: true, status: 200, headers: HEADERS, json: async () => ({ node: { ref: { id: 'new-img' } } }) }
  }
  if (u.includes('/children')) {
    return { ok: true, status: 200, headers: HEADERS, json: async () => ({ nodes: children }) }
  }
  if (u.includes('/content')) {
    return { ok: true, status: 200, headers: HEADERS, json: async () => ({}) }
  }
  if ((opts.method || 'GET') === 'DELETE') {
    return { ok: true, status: 200, headers: HEADERS, json: async () => ({}) }
  }
  if (u.includes('/comment/')) {
    if ((opts.method || 'GET') === 'GET') {
      return {
        ok: true, status: 200, headers: HEADERS,
        json: async () => ({ comments: [
          { ref: { id: 'c1' }, replyTo: null, created: 2, comment: 'Zweiter', creator: { authorityName: 'anna' } },
          { ref: { id: 'c0' }, replyTo: null, created: 1, comment: 'Erster', creator: { authorityName: 'jan' } },
          { ref: { id: 'c2' }, replyTo: 'c0', created: 3, comment: 'Antwort', creator: { authorityName: 'anna' } },
        ] }),
      }
    }
    return { ok: true, status: 200, headers: HEADERS, json: async () => ({}) }
  }
  return { ok: false, status: 404, headers: HEADERS, json: async () => ({}), text: async () => 'not found' }
}

const { createImage, cleanupOrphanImages, imageUrl } = await import('../server/images.js')
const { listComments, addComment, deleteComment } = await import('../server/edu-sharing-api.js')
const AUTH = 'Basic dGVzdDpwdw=='

// --- images: create child-IO + upload bytes ---------------------------------------
const created = await createImage('parent-1', 'Foto Süd.png', 'image/png', new Uint8Array([1, 2, 3]), AUTH)
const createCall = calls.find((c) => c.url.includes('/children') && c.method === 'POST')
const contentCall = calls.find((c) => c.url.includes('/nodes/-home-/new-img/content'))
check('createImage creates the child-IO as a series object',
  createCall && decodeURIComponent(createCall.url).includes('assocType=ccm:childio')
  && decodeURIComponent(createCall.url).includes('aspects=ccm:io_childobject')
  && createCall.body.includes('mdimg-'), createCall?.url)
check('createImage uploads the bytes to the new child', Boolean(contentCall), calls.map((c) => c.url))
check('createImage returns id + stable download url',
  created.imageId === 'new-img' && created.url === imageUrl('new-img')
  && created.url.includes('eduservlet/download?nodeId=new-img'), created)

// A filename that strips to nothing must still yield a usable, prefixed name
await createImage('parent-1', '###', 'image/png', new Uint8Array([1]), AUTH)
const emptyNameCall = calls.filter((c) => c.url.includes('/children') && c.method === 'POST').pop()
check('createImage falls back to "bild" when the filename strips to nothing',
  emptyNameCall.body.includes('"mdimg-bild"'), emptyNameCall?.body)

// --- images: anonymous readability mirrors the parent -------------------------------
// Markdown embeds the repo download URL, which browsers fetch WITHOUT an
// edu-sharing session — on a publicly readable parent the image must get
// GROUP_EVERYONE Consumer (preview quirk: inheritance alone is not enough),
// on a restricted parent it must deliberately stay restricted.
calls.length = 0
await createImage('parent-1', 'pub.png', 'image/png', new Uint8Array([1]), AUTH)
const probe = calls.find((c) => c.url.includes('/metadata'))
const grant = calls.find((c) => c.url.includes('/permissions') && c.method === 'POST')
check('public parent: anonymous probe runs WITHOUT auth header',
  probe && !probe.headers?.Authorization, probe?.headers)
check('public parent: image gets GROUP_EVERYONE Consumer (renders anonymously)',
  grant && grant.body.includes('GROUP_EVERYONE') && grant.body.includes('Consumer')
  && JSON.parse(grant.body).inherited === true, grant?.body)
parentPublic = false
calls.length = 0
await createImage('parent-1', 'priv.png', 'image/png', new Uint8Array([1]), AUTH)
check('restricted parent: image stays restricted (no EVERYONE grant)',
  !calls.some((c) => c.url.includes('/permissions')), calls.map((c) => c.url))
parentPublic = true

// --- images: orphan cleanup only touches OUR prefixed children ---------------------
calls.length = 0
const removed = await cleanupOrphanImages('parent-1', `Text mit ![Bild](${imageUrl('img-1')}) drin.`, AUTH)
const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.url)
check('cleanup deletes the orphaned editor image (img-2)',
  removed === 1 && deletes.length === 1 && deletes[0].includes('img-2'), deletes)
check('cleanup NEVER touches referenced images or foreign children',
  !deletes.some((u) => u.includes('img-1') || u.includes('other')), deletes)

// --- comments: list is sorted + flagged ---------------------------------------------
const list = await listComments('node-1', AUTH, 'jan')
check('listComments sorts by created and maps the shape',
  list.length === 3 && list[0].id === 'c0' && list[2].id === 'c2' && list[2].replyTo === 'c0', list)
check('listComments marks own comments', list[0].isOwn === true && list[1].isOwn === false, list)

// --- comments: the 415 trap — application/json with RAW utf-8 bytes ----------------
calls.length = 0
await addComment('node-1', 'Ein Kommentar mit Ümlauten', AUTH)
const put = calls.find((c) => c.method === 'PUT')
check('addComment sends RAW bytes with application/json content-type (415 trap)',
  put && String(put.headers['Content-Type']).startsWith('application/json')
  && put.body === 'Ein Kommentar mit Ümlauten', { headers: put?.headers, body: put?.body })
await addComment('node-1', 'Antwort', AUTH, 'c0')
check('reply goes through the commentReference query param',
  calls.some((c) => c.method === 'PUT' && c.url.includes('commentReference=c0')), calls.at(-1)?.url)

// --- comments: delete ---------------------------------------------------------------
calls.length = 0
await deleteComment('c1', AUTH)
check('deleteComment issues the DELETE', calls.some((c) => c.method === 'DELETE' && c.url.includes('c1')))

process.exit(fail ? 1 : 0)
