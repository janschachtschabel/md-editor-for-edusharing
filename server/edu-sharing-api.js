/**
 * edu-sharing REST client: auth validation, node info, loading/saving the
 * markdown text. Knows nothing about Yjs/collaboration logic.
 *
 * Storage targets (file content is deliberately NEVER touched):
 *  - default           → property ccm:oeh_collection_compendium_text via
 *                        POST /property (setProperty) — on ccm:map AND ccm:io
 *  - field=description → cm:description + cclom:general_description via PUT /metadata
 */
import { EDU_BASE, EDU_REST, EDU_TIMEOUT_MS, ENV_AUTH } from './config.js'
import { isValidNodeId } from './guards.js'

export const COMPENDIUM_PROP = 'ccm:oeh_collection_compendium_text'
/** Entity annotations are persisted as general keywords: "Weimar (Stadt)". */
export const KEYWORD_PROP = 'cclom:general_keyword'

/** Allowed storage-target flags; anything else → default (compendium). */
export function normalizeField(field) {
  return ['compendium', 'description'].includes(field) ? field : ''
}

/**
 * Document name in the Yjs network: "<nodeId>" | "<nodeId>:compendium" |
 * "<nodeId>:description". The room name is chosen by the CLIENT — validate the
 * node ID before it can reach any REST URL (re-audit F-B).
 * @throws {Error} with status 400 for malformed node IDs
 */
export function parseDocumentName(documentName) {
  const [nodeId, flag] = String(documentName).split(':')
  if (!isValidNodeId(nodeId)) {
    const err = new Error(`Ungültige Node-ID: ${nodeId.slice(0, 50)}`)
    err.status = 400
    throw err
  }
  return { nodeId, field: normalizeField(flag) }
}

export function buildDocumentName(nodeId, field) {
  const f = normalizeField(field)
  return f ? `${nodeId}:${f}` : nodeId
}

/**
 * HTTP wrapper for the edu-sharing REST API.
 * @param {string} pathname Path relative to <repo>/edu-sharing/rest
 * @param {object} [opts] method/headers/body as in fetch; `auth` overrides the
 *   Authorization header (default: service account from .env, else anonymous)
 * @throws {Error} with a `status` field on non-2xx responses
 */
export async function eduFetch(pathname, { method = 'GET', headers = {}, body, auth } = {}) {
  const h = { Accept: 'application/json', ...headers }
  const authHeader = auth === undefined ? ENV_AUTH : auth
  if (authHeader) h.Authorization = authHeader
  let res
  try {
    // Timeout so a hung edu-sharing call cannot block the request forever (F-07)
    res = await fetch(EDU_REST + pathname, { method, headers: h, body, signal: AbortSignal.timeout(EDU_TIMEOUT_MS) })
  } catch (cause) {
    const err = new Error(`edu-sharing ${method} ${pathname} → ${cause.name === 'TimeoutError' ? 'timeout' : cause.message}`)
    err.status = 504
    throw err
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`edu-sharing ${method} ${pathname} → ${res.status}: ${text.slice(0, 300)}`)
    err.status = res.status
    throw err
  }
  const ct = res.headers.get('content-type') || ''
  return ct.includes('application/json') ? res.json() : res.text()
}

/**
 * Check whether an auth header is valid AND has write access on a node.
 * Used by the mutation endpoints (audit F-01, F-02) to gate saving.
 * @returns {Promise<{ok: boolean, status: number, error?: string}>}
 */
export async function checkWriteAccess(nodeId, field, authHeader) {
  if (!authHeader) return { ok: false, status: 401, error: 'Anmeldung erforderlich' }
  try {
    const info = await getNodeInfo(nodeId, field, authHeader)
    if (info.contentBlocked) return { ok: false, status: 422, error: info.blockReason }
    if (!(info.access || []).includes('Write')) {
      return { ok: false, status: 403, error: 'Kein Schreibrecht auf diesem Knoten' }
    }
    return { ok: true, status: 200 }
  } catch (err) {
    // 401 from edu-sharing = invalid credentials; anything else = upstream issue
    return { ok: false, status: err.status === 401 ? 401 : 502, error: err.message }
  }
}

/** Validate a login: check the Basic auth header against edu-sharing. */
export async function validateLogin(authHeader) {
  const data = await eduFetch('/iam/v1/people/-home-/-me-', { auth: authHeader })
  const p = data.person || data
  const name = [p?.profile?.firstName, p?.profile?.lastName].filter(Boolean).join(' ')
  return { displayName: name || p?.authorityName || 'Unbekannt', authorityName: p?.authorityName }
}

/**
 * Read node metadata and determine the editing mode.
 * @param {string} nodeId edu-sharing node ID
 * @param {''|'compendium'|'description'} [field] storage-target flag
 * @param {string|undefined} [auth] Basic auth header; undefined = .env fallback/anonymous
 */
export async function getNodeInfo(nodeId, field = '', auth = undefined) {
  const data = await eduFetch(`/node/v1/nodes/-home-/${nodeId}/metadata?propertyFilter=-all-`, { auth })
  const node = data.node
  const props = node.properties || {}
  const isIo = node.type === 'ccm:io'
  const isMap = node.type === 'ccm:map'

  // Determine the editing mode
  let mode = null, targetLabel = null, blocked = false, blockReason = null
  if (!isIo && !isMap) {
    blocked = true
    blockReason = `Knotentyp ${node.type} wird nicht unterstützt (nur ccm:io und ccm:map).`
  } else if (field === 'description') {
    mode = 'description'
    targetLabel = 'Beschreibung (cm:description / cclom:general_description)'
  } else {
    mode = 'compendium'
    targetLabel = `Kompendium-Property (${COMPENDIUM_PROP}) auf ${node.type}`
  }

  const hasAuth = Boolean(auth === undefined ? ENV_AUTH : auth)
  return {
    nodeId,
    title: node.title || node.name || nodeId,
    name: node.name,
    type: node.type,
    access: node.access || [],
    // Reference nodes: writes must go to the original (edu-sharing quirk)
    originalId: node.originalId && node.originalId !== nodeId ? node.originalId : null,
    mode,
    targetLabel,
    contentBlocked: blocked,
    blockReason,
    canWrite: hasAuth && !blocked && (node.access || []).includes('Write'),
    renderUrl: `${EDU_BASE}/edu-sharing/components/render/${nodeId}`,
    compendium: (props[COMPENDIUM_PROP] || [''])[0] || '',
    description: (props['cclom:general_description'] || props['cm:description'] || [''])[0] || '',
    keywords: props[KEYWORD_PROP] || [],
  }
}

/** Extract the markdown text from a getNodeInfo response (depending on mode). */
export function loadMarkdown(info) {
  return info.mode === 'description' ? info.description : info.compendium
}

/**
 * Set a (possibly multi-value) property via the dedicated setProperty
 * endpoint. IMPORTANT: PUT /metadata filters properties against the MDS —
 * undefined properties get SILENTLY dropped (200 OK, nothing stored;
 * verified on staging 07/2026). setProperty bypasses the MDS filter.
 */
async function setProperty(nodeId, property, values, auth) {
  await eduFetch(`/node/v1/nodes/-home-/${nodeId}/property?property=${encodeURIComponent(property)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
    auth,
  })
}

/** Write the general keywords (entity annotations serialized as "Name (Typ)"). */
export async function saveKeywords(nodeId, keywords, auth) {
  await setProperty(nodeId, KEYWORD_PROP, keywords, auth)
}

/**
 * Write the markdown text to the repository.
 * @param {string} nodeId target node (for references: the original)
 * @param {'compendium'|'description'} mode storage target
 * @param {string} markdown text to store
 * @param {string} auth Basic auth header of the writing session
 */
export async function saveMarkdown(nodeId, mode, markdown, auth) {
  if (mode === 'compendium') {
    await setProperty(nodeId, COMPENDIUM_PROP, [markdown], auth)
    return
  }
  // mode 'description': write both namespaces (otherwise the edu-sharing UI
  // may only show one of them)
  await eduFetch(`/node/v1/nodes/-home-/${nodeId}/metadata?versionComment=Beschreibung+bearbeitet+(MD-Editor-Demo)`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'cm:description': [markdown],
      'cclom:general_description': [markdown],
    }),
    auth,
  })
}
