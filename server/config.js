/**
 * Central server configuration (from environment variables).
 * All other server modules read their settings from here.
 */
import 'dotenv/config'

/** Repository base without /edu-sharing, e.g. https://repository.staging.openeduhub.net */
export const EDU_BASE = (process.env.EDU_REPO_BASE_URL || 'https://repository.staging.openeduhub.net').replace(/\/$/, '')
export const EDU_REST = `${EDU_BASE}/edu-sharing/rest`

export const EDU_USER = process.env.EDU_USER || ''
export const EDU_PASS = process.env.EDU_PASS || ''

/** Optional service-account fallback as a ready-made Basic auth header (or null). */
export const ENV_AUTH = EDU_USER && EDU_PASS
  ? 'Basic ' + Buffer.from(`${EDU_USER}:${EDU_PASS}`).toString('base64')
  : null

export const PORT = Number(process.env.PORT || 3000)

/**
 * Repo sync strategy: Yjs synchronizes users in real time, the repository is
 * pure persistence — writes can therefore be much less frequent. At the
 * earliest SAVE_DEBOUNCE_MS after the last change, at the latest every
 * SAVE_MAX_DEBOUNCE_MS while typing continuously.
 */
export const SAVE_DEBOUNCE_MS = Number(process.env.SAVE_DEBOUNCE_MS || 15000)
export const SAVE_MAX_DEBOUNCE_MS = Number(process.env.SAVE_MAX_DEBOUNCE_MS || 90000)
export const SAVE_RETRY_MS = 30000

/** Timeout for every edu-sharing REST call (audit F-07). */
export const EDU_TIMEOUT_MS = Number(process.env.EDU_TIMEOUT_MS || 15000)

/** Login rate limit per client IP (audit F-05). */
export const LOGIN_RATE_MAX = Number(process.env.LOGIN_RATE_MAX || 10)
export const LOGIN_RATE_WINDOW_MS = Number(process.env.LOGIN_RATE_WINDOW_MS || 300000)

/** Sliding TTL of server-side login sessions (audit F-08). Default: 8 h. */
export const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 8 * 60 * 60 * 1000)

/**
 * Number of trusted reverse-proxy hops in front of this server (re-audit F-A).
 * 0 = no proxy (req.ip = socket address). Do NOT use a blanket "trust all" —
 * that lets clients spoof their IP via X-Forwarded-For and bypass the login
 * rate limit. Set to 1 behind a single reverse proxy (nginx, Render, …).
 */
export const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS || 0)

/**
 * Local development only: connections without a login may edit
 * (saving still requires an authenticated session).
 */
export const ALLOW_ANONYMOUS_EDIT = process.env.ALLOW_ANONYMOUS_EDIT === 'true'

/**
 * CORS allowlist for cross-origin embedding (e.g. the component running
 * inside an edu-sharing page while the collab server lives elsewhere).
 * Comma-separated origins or '*'; empty = same-origin only (no CORS headers).
 * Example: ALLOWED_ORIGINS=https://repository.staging.openeduhub.net
 */
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)
