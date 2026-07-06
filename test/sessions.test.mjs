// Unit tests for the server-side session store (audit F-08): opaque tokens
// instead of credentials in the browser, TTL expiry, revocation.
import { createSessionStore } from '../server/sessions.js'

let fail = 0
function check(name, ok, extra = '') {
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : extra)
}

const T = 1_000_000
const store = createSessionStore({ ttlMs: 60_000 })

// create → opaque token, resolvable to the stored auth header
const token = store.create({ authHeader: 'Basic abc', displayName: 'Jan' }, T)
check('token is opaque (no credentials inside)', !token.includes('abc') && token.length >= 32)
check('token resolves to the session', store.get(token, T + 1)?.authHeader === 'Basic abc')
check('unknown token resolves to null', store.get('nope', T) === null)

// sliding TTL: usage extends the session
store.get(token, T + 50_000)
check('sliding TTL keeps active session alive', store.get(token, T + 100_000)?.displayName === 'Jan')

// expiry without usage
const t2 = store.create({ authHeader: 'Basic xyz', displayName: 'X' }, T)
check('expired session resolves to null', store.get(t2, T + 61_000) === null)

// revoke (logout)
store.revoke(token)
check('revoked session resolves to null', store.get(token, T + 100_001) === null)

// sweep removes expired entries from memory
const t3 = store.create({ authHeader: 'Basic 3' }, T)
store.sweep(T + 61_000)
check('sweep drops expired sessions', store.size() === 0, `size=${store.size()} t3=${Boolean(t3)}`)

process.exit(fail ? 1 : 0)
