/**
 * Server-side session store (audit F-08): after login the browser only holds
 * an opaque, revocable token — the Basic auth header (credentials) stays in
 * server memory with a sliding TTL. An XSS can then steal a session handle,
 * not the user's WLO credentials.
 */
import { randomBytes } from 'node:crypto'
import { SESSION_TTL_MS } from './config.js'

/**
 * @param {{ttlMs: number}} opts sliding time-to-live per session
 */
export function createSessionStore({ ttlMs }) {
  const sessions = new Map() // token → {authHeader, displayName, authorityName, expiresAt}

  return {
    /** Store a session; returns the opaque token handed to the client. */
    create(data, now = Date.now()) {
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, { ...data, expiresAt: now + ttlMs })
      return token
    },

    /** Resolve a token; refreshes the sliding TTL. Returns null if unknown/expired. */
    get(token, now = Date.now()) {
      const s = sessions.get(token)
      if (!s) return null
      if (s.expiresAt <= now) {
        sessions.delete(token)
        return null
      }
      s.expiresAt = now + ttlMs
      return s
    },

    /** Logout: drop the session immediately. */
    revoke(token) {
      sessions.delete(token)
    },

    /** Remove all expired sessions (called periodically). */
    sweep(now = Date.now()) {
      for (const [token, s] of sessions) {
        if (s.expiresAt <= now) sessions.delete(token)
      }
    },

    size() {
      return sessions.size
    },
  }
}

/** App-wide singleton used by the HTTP API and the collaboration layer. */
export const sessionStore = createSessionStore({ ttlMs: SESSION_TTL_MS })

/**
 * Resolve an Authorization header (or WS token) to a Basic auth header:
 *  - opaque session token  → stored Basic header (preferred path)
 *  - "Basic …" passthrough → kept as-is (non-browser API clients)
 * Returns {authHeader, session} — authHeader null means "presented but invalid".
 */
export function resolveAuthToken(value) {
  if (!value) return { authHeader: undefined, session: null }
  const raw = value.startsWith('Bearer ') ? value.slice(7) : value
  if (raw.startsWith('Basic ')) return { authHeader: raw, session: null }
  const session = sessionStore.get(raw)
  if (session) return { authHeader: session.authHeader, session }
  return { authHeader: null, session: null }
}
