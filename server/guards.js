/**
 * Pure security guards, unit-tested in isolation:
 *  - createRateLimiter: sliding-window limiter for /api/login (audit F-05)
 *  - isOriginAllowed:   Origin check for the WebSocket upgrade (audit F-06)
 *  - isValidNodeId:     node-ID format check before URL interpolation (re-audit F-B)
 */

/**
 * Sliding-window rate limiter keyed by an arbitrary string (e.g. client IP).
 * @param {{windowMs: number, max: number}} opts window length and max hits
 * @returns {(key: string, now?: number) => boolean} true = request allowed
 */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map() // key → number[] (timestamps within the window)
  return function allow(key, now = Date.now()) {
    // Opportunistic sweep so the map cannot grow without bound
    if (hits.size > 10_000) {
      for (const [k, arr] of hits) {
        if (arr.every((t) => now - t >= windowMs)) hits.delete(k)
      }
    }
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs)
    if (recent.length >= max) {
      hits.set(key, recent)
      return false
    }
    recent.push(now)
    hits.set(key, recent)
    return true
  }
}

/**
 * Origin check for WebSocket upgrades (CORS does not apply to WS).
 * A missing Origin header is allowed: it only occurs for non-browser clients,
 * which an origin check cannot defend against anyway — the check targets
 * cross-site requests from browsers.
 * @param {string|undefined} origin  Origin request header
 * @param {string} host              Host request header (own host:port)
 * @param {string[]} allowedOrigins  configured allowlist ('*' = any)
 */
export function isOriginAllowed(origin, host, allowedOrigins) {
  if (!origin) return true
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SYMBOLIC_RE = /^-[a-z]+-$/i // edu-sharing constants like -home-, -userhome-

/**
 * Validate a node ID before it is interpolated into an edu-sharing REST URL.
 * Node IDs are UUIDs or symbolic constants — anything else (slashes, query
 * or fragment characters) would allow request forgery against the repository
 * under the caller's identity (re-audit F-B).
 */
export function isValidNodeId(nodeId) {
  return typeof nodeId === 'string' && (UUID_RE.test(nodeId) || SYMBOLIC_RE.test(nodeId))
}
