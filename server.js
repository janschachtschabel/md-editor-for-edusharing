/**
 * Entry point: Express (frontend + status/login API) and Hocuspocus (Yjs
 * collaboration) on a single HTTP server; WebSocket upgrade on /collab.
 *
 * Module responsibilities:
 *   server/config.js           configuration from environment variables
 *   server/edu-sharing-api.js  REST client (login, nodes, load/save)
 *   server/collab.js           Yjs server, buffering strategy, persistence
 *   server/guards.js           rate limiter + WebSocket origin check
 *   src/                       browser code (web component, host page) +
 *                              shared markdown/extension modules
 */
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crossws from 'crossws/adapters/node'
import {
  ALLOW_ANONYMOUS_EDIT, ALLOWED_ORIGINS, EDU_BASE, EDU_USER, ENV_AUTH, PORT,
  LOGIN_RATE_MAX, LOGIN_RATE_WINDOW_MS, SAVE_DEBOUNCE_MS, SAVE_MAX_DEBOUNCE_MS,
  TRUST_PROXY_HOPS,
} from './server/config.js'
import {
  buildDocumentName, checkWriteAccess, getNodeInfo, normalizeField, validateLogin,
} from './server/edu-sharing-api.js'
import {
  broadcastConfig, docState, hocuspocus, persistDocument,
} from './server/collab.js'
import {
  createRateLimiter, isBasicAuthPassthrough, isOriginAllowed, isValidNodeId,
} from './server/guards.js'
import { closeSessionConnections, resolveAuthToken, sessionStore } from './server/sessions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
// Trust exactly the configured number of proxy hops — never "true", which
// would let clients spoof req.ip via X-Forwarded-For and bypass the login
// rate limit (re-audit F-A).
app.set('trust proxy', TRUST_PROXY_HOPS)

// Baseline security headers (re-audit F-C). Deliberately NO
// X-Frame-Options: DENY — embedding inside edu-sharing pages is a feature;
// framing is controlled via CSP frame-ancestors from the origin allowlist.
const frameAncestors = ALLOWED_ORIGINS.includes('*')
  ? '*'
  : ["'self'", ...ALLOWED_ORIGINS].join(' ')
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors}`)
  next()
})

// CORS for cross-origin embedding (e.g. the component inside an edu-sharing
// page while the collab server runs elsewhere).
// Without ALLOWED_ORIGINS no CORS headers are sent (same-origin only).
if (ALLOWED_ORIGINS.length > 0) {
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin && (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })
}

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

/** Document name from request parameters (nodeId + optional field flag). */
function documentNameFromRequest(req) {
  return buildDocumentName(req.params.id, normalizeField(req.query.field))
}

/** Liveness probe for orchestrators / load balancers (audit F-09). */
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.get('/api/config', (_req, res) => {
  res.json({ repoBase: EDU_BASE, hasServiceAccount: Boolean(ENV_AUTH) })
})

// Rate limiter guarding the login proxy against brute force (audit F-05)
const loginLimiter = createRateLimiter({ windowMs: LOGIN_RATE_WINDOW_MS, max: LOGIN_RATE_MAX })
// Separate limiter for raw Basic-auth passthrough on the node routes below —
// that path bypasses /api/login entirely and was previously unthrottled,
// turning this server into an unlimited credential-guessing oracle against
// the upstream repository (audit S-1).
const basicAuthLimiter = createRateLimiter({ windowMs: LOGIN_RATE_WINDOW_MS, max: LOGIN_RATE_MAX })
const RATE_LIMIT_MSG = { error: 'Zu viele Anmeldeversuche — bitte später erneut versuchen' }

/** True if the request was throttled (and a 429 was already sent). */
function isBasicAuthRateLimited(req, res) {
  if (isBasicAuthPassthrough(req.headers.authorization) && !basicAuthLimiter(req.ip)) {
    res.status(429).json(RATE_LIMIT_MSG)
    return true
  }
  return false
}

/**
 * Validate a WLO login. Returns an OPAQUE server-side session token (audit
 * F-08) — the credentials never reach browser storage; the auth header stays
 * in server memory with a sliding TTL and can be revoked via /api/logout.
 *
 * Two login shapes:
 *   {username, password} — interactive login (demo host page)
 *   {ticket}             — edu-sharing ticket, for embedding inside an
 *                          edu-sharing page that already has a session
 */
app.post('/api/login', async (req, res) => {
  if (!loginLimiter(req.ip)) {
    return res.status(429).json(RATE_LIMIT_MSG)
  }
  const { username, password, ticket } = req.body || {}
  let authHeader
  if (ticket) {
    authHeader = `EDU-TICKET ${ticket}`
  } else if (username && password) {
    authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
  } else {
    return res.status(400).json({ error: 'Benutzername und Passwort (oder Ticket) erforderlich' })
  }
  try {
    const who = await validateLogin(authHeader)
    const token = sessionStore.create({ authHeader, displayName: who.displayName, authorityName: who.authorityName })
    res.json({ token, displayName: who.displayName, authorityName: who.authorityName })
  } catch (err) {
    const msg = err.status === 401
      ? (ticket ? 'Ticket ungültig oder abgelaufen' : 'Benutzername oder Passwort falsch')
      : `edu-sharing nicht erreichbar (${err.message})`
    res.status(err.status === 401 ? 401 : 502).json({ error: msg })
  }
})

/**
 * Logout: revoke the server-side session AND close every open collaboration
 * connection that authenticated with it — otherwise a second tab/device on
 * the same session would keep its presence + write access until closed
 * (and, with the token revoked FIRST, any reconnect attempt is rejected).
 */
app.post('/api/logout', (req, res) => {
  const value = req.headers.authorization || ''
  const token = value.startsWith('Bearer ') ? value.slice(7) : value
  sessionStore.revoke(token)
  closeSessionConnections(token)
  res.sendStatus(204)
})

/** Node info + save status for the host page (session token or Basic passthrough). */
app.get('/api/nodes/:id', async (req, res) => {
  if (!isValidNodeId(req.params.id)) return res.status(400).json({ error: 'Ungültige Node-ID' })
  if (isBasicAuthRateLimited(req, res)) return
  const field = normalizeField(req.query.field)
  const { authHeader } = resolveAuthToken(req.headers.authorization)
  const auth = authHeader || undefined // invalid session degrades to anonymous read
  try {
    const info = await getNodeInfo(req.params.id, field, auth)
    const state = docState.get(documentNameFromRequest(req))
    res.json({
      ...info,
      lastSavedAt: state?.lastSavedAt ?? null,
      lastChangedAt: state?.lastChangedAt ?? null,
      dirty: state?.dirty ?? false,
      autosave: state?.autosave ?? true,
      lastError: state?.lastError ?? null,
      saveDebounceMs: SAVE_DEBOUNCE_MS,
      saveMaxDebounceMs: SAVE_MAX_DEBOUNCE_MS,
    })
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message })
  }
})

/**
 * Gate mutation endpoints: the caller must present a valid login WITH write
 * access on the node (audit F-01, F-02). Returns the loaded doc state on
 * success, or sends the appropriate error response and returns null.
 */
async function requireWriteAccess(req, res) {
  if (!isValidNodeId(req.params.id)) {
    res.status(400).json({ error: 'Ungültige Node-ID' })
    return null
  }
  if (isBasicAuthRateLimited(req, res)) return null
  const field = normalizeField(req.query.field)
  const { authHeader } = resolveAuthToken(req.headers.authorization)
  if (authHeader === null) {
    res.status(401).json({ error: 'Sitzung abgelaufen — bitte neu anmelden' })
    return null
  }
  const access = await checkWriteAccess(req.params.id, field, authHeader)
  if (!access.ok) {
    res.status(access.status).json({ error: access.error })
    return null
  }
  const documentName = documentNameFromRequest(req)
  const state = docState.get(documentName)
  const doc = hocuspocus.documents.get(documentName)
  if (!state || !doc) {
    res.status(404).json({ error: 'Dokument ist nicht geladen' })
    return null
  }
  return { documentName, state, doc }
}

/** Toggle autosave for a loaded document (applies to all users). */
app.post('/api/nodes/:id/autosave', async (req, res) => {
  const ctx = await requireWriteAccess(req, res)
  if (!ctx) return
  const { documentName, state, doc } = ctx
  state.autosave = Boolean(req.body?.enabled)
  console.log(`[autosave] ${documentName} → ${state.autosave ? 'ON' : 'OFF'}`)
  broadcastConfig(documentName, doc) // update all clients' save displays
  // When re-enabled, catch up on buffered changes immediately
  if (state.autosave && state.dirty) persistDocument(documentName, doc)
  res.json({ autosave: state.autosave })
})

/** Save immediately (independent of the autosave switch). */
app.post('/api/nodes/:id/save', async (req, res) => {
  const ctx = await requireWriteAccess(req, res)
  if (!ctx) return
  const { documentName, state, doc } = ctx
  await persistDocument(documentName, doc, true)
  res.json({ lastSavedAt: state.lastSavedAt, lastError: state.lastError, dirty: state.dirty })
})

// ------------------------------------------------------------- Bootstrap ---
// Periodically drop expired login sessions (unref: doesn't keep the process alive)
setInterval(() => sessionStore.sweep(), 10 * 60 * 1000).unref()

const server = http.createServer(app)

// WebSocket upgrade for Hocuspocus on /collab — Hocuspocus v4 integrates via
// the crossws node adapter (documented pattern): the adapter performs the
// upgrade and feeds open/message/close into the Hocuspocus client connection.
const ws = crossws({
  hooks: {
    open(peer) {
      peer._hocuspocus = hocuspocus.handleConnection(peer.websocket, peer.request)
    },
    message(peer, message) {
      peer._hocuspocus?.handleMessage(message.uint8Array())
    },
    close(peer, event) {
      peer._hocuspocus?.handleClose({ code: event.code, reason: event.reason })
    },
  },
})

server.on('upgrade', (request, socket, head) => {
  // Reject cross-site WebSocket connections (CORS does not apply to WS) — F-06
  if (!isOriginAllowed(request.headers.origin, request.headers.host, ALLOWED_ORIGINS)) {
    socket.destroy()
    return
  }
  const { pathname } = new URL(request.url, 'http://localhost')
  if (pathname.startsWith('/collab')) {
    ws.handleUpgrade(request, socket, head)
  } else {
    socket.destroy()
  }
})

server.listen(PORT, () => {
  console.log(`MD editor demo running at  http://localhost:${PORT}`)
  console.log(`Repository:                ${EDU_BASE}`)
  console.log(`Service account:           ${ENV_AUTH ? `configured (${EDU_USER})` : 'none (user login required for saving)'}`)
  if (ALLOWED_ORIGINS.length) console.log(`CORS allowed origins:      ${ALLOWED_ORIGINS.join(', ')}`)
  if (ALLOW_ANONYMOUS_EDIT) console.log('WARNING: ALLOW_ANONYMOUS_EDIT=true (local development only)')
})
