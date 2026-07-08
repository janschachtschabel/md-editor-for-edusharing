// Unit tests for the pure security guards: login rate limiter (F-05),
// WebSocket origin check (F-06) and node-ID validation (re-audit F-B).
import { createRateLimiter, isBasicAuthPassthrough, isOriginAllowed, isValidNodeId } from '../server/guards.js'

let fail = 0
function check(name, ok) {
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name)
}

// --- rate limiter -----------------------------------------------------------
{
  const limit = createRateLimiter({ windowMs: 60_000, max: 3 })
  const T = 1_000_000
  check('first three attempts pass', limit('ip1', T) && limit('ip1', T + 1) && limit('ip1', T + 2))
  check('fourth attempt within window is blocked', limit('ip1', T + 3) === false)
  check('other key is unaffected', limit('ip2', T + 3) === true)
  check('window expiry frees the key', limit('ip1', T + 61_000) === true)
  check('still blocked right before expiry', (() => {
    const l = createRateLimiter({ windowMs: 60_000, max: 1 })
    l('k', T)
    return l('k', T + 59_999) === false
  })())
}

// --- origin check -----------------------------------------------------------
{
  // no Origin header (non-browser clients): allowed — origin checks only
  // defend against cross-site browser requests
  check('missing origin allowed', isOriginAllowed(undefined, 'demo.example:3000', []))
  check('same-host origin allowed', isOriginAllowed('https://demo.example:3000', 'demo.example:3000', []))
  check('foreign origin blocked without allowlist', isOriginAllowed('https://evil.example', 'demo.example:3000', []) === false)
  check('allowlisted origin allowed', isOriginAllowed('https://ui.example', 'demo.example:3000', ['https://ui.example']))
  check('wildcard allows any origin', isOriginAllowed('https://evil.example', 'demo.example:3000', ['*']))
  check('malformed origin blocked', isOriginAllowed('not a url', 'demo.example:3000', []) === false)
}

// --- node-ID validation (F-B: no URL injection via Yjs room names) --------
{
  check('UUID is valid', isValidNodeId('bd898a4c-311b-48d8-9a40-bea930811c8e'))
  check('uppercase UUID is valid', isValidNodeId('BD898A4C-311B-48D8-9A40-BEA930811C8E'))
  check('symbolic id is valid', isValidNodeId('-userhome-'))
  check('query injection blocked', isValidNodeId('bd898a4c?maxItems=1') === false)
  check('path traversal blocked', isValidNodeId('../admin/v1/x') === false)
  check('path segment blocked', isValidNodeId('a/b') === false)
  check('fragment blocked', isValidNodeId('x#y') === false)
  check('empty blocked', isValidNodeId('') === false)
  check('random word blocked', isValidNodeId('kartoffel') === false)
}

// --- Basic-auth passthrough detection (audit S-1: this path bypasses the
// login rate limiter unless callers apply one explicitly) -------------------
{
  const basic = 'Basic ' + Buffer.from('writer:pw').toString('base64')
  check('raw Basic header is passthrough', isBasicAuthPassthrough(basic))
  check('Bearer-wrapped Basic header is still passthrough', isBasicAuthPassthrough(`Bearer ${basic}`))
  check('opaque session token is NOT passthrough', isBasicAuthPassthrough('Bearer abc123opaque') === false)
  check('missing header is NOT passthrough', isBasicAuthPassthrough(undefined) === false)
  check('empty header is NOT passthrough', isBasicAuthPassthrough('') === false)
}

process.exit(fail ? 1 : 0)
