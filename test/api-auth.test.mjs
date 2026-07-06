// Integration tests for the HTTP API security fixes (audit F-01, F-02, F-05,
// F-09): spawns the real server against a mock edu-sharing repository and
// asserts authentication/authorization/rate-limit behavior over real HTTP.
import { spawn } from 'node:child_process'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const MOCK_PORT = 3802
const APP_PORT = 3801
const APP = `http://127.0.0.1:${APP_PORT}`

const WRITER = 'Basic ' + Buffer.from('writer:pw').toString('base64')
const READER = 'Basic ' + Buffer.from('reader:pw').toString('base64')
const TICKET = 'EDU-TICKET valid-ticket-123' // edu-sharing ticket auth header

let fail = 0
function check(name, ok, extra = '') {
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : extra)
}

// --- mock edu-sharing repository -------------------------------------------
const mock = http.createServer((req, res) => {
  const auth = req.headers.authorization
  const known = auth === WRITER || auth === READER || auth === TICKET
  res.setHeader('Content-Type', 'application/json')
  if (req.url.includes('/iam/v1/people/')) {
    if (!known) { res.statusCode = 401; return res.end('{}') }
    return res.end(JSON.stringify({ person: { authorityName: auth === READER ? 'reader' : 'writer' } }))
  }
  if (req.url.includes('/metadata')) {
    // Writer and ticket user have Write access, reader/anonymous only Read
    const access = (auth === WRITER || auth === TICKET) ? ['Read', 'Write'] : ['Read']
    return res.end(JSON.stringify({
      node: { ref: { id: 'n1' }, type: 'ccm:map', name: 'Mock', title: 'Mock', access, properties: {} },
    }))
  }
  res.statusCode = 404
  res.end('{}')
})

// --- helpers ----------------------------------------------------------------
async function waitFor(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return true } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

async function post(pathname, headers = {}, body = undefined) {
  const res = await fetch(APP + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return res
}

// --- run ---------------------------------------------------------------------
mock.listen(MOCK_PORT)
const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    EDU_REPO_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
    LOGIN_RATE_MAX: '6',
    LOGIN_RATE_WINDOW_MS: '60000',
    ALLOW_ANONYMOUS_EDIT: '',
    EDU_USER: '', EDU_PASS: '', ALLOWED_ORIGINS: '',
  },
  stdio: 'ignore',
})

try {
  check('server becomes healthy (/health)', await waitFor(`${APP}/health`))

  // Re-audit F-B: malformed node IDs are rejected before any upstream call
  check('GET node with invalid id → 400',
    (await fetch(`${APP}/api/nodes/not-a-uuid`)).status === 400)
  check('/save with invalid id → 400',
    (await post('/api/nodes/x%3FmaxItems=1/save', { Authorization: WRITER })).status === 400)

  // Re-audit F-C: baseline security headers present
  const health = await fetch(`${APP}/health`)
  check('nosniff header set', health.headers.get('x-content-type-options') === 'nosniff')
  check('CSP frame-ancestors set', (health.headers.get('content-security-policy') || '').includes('frame-ancestors'))

  // F-01: /save requires authentication and write permission
  check('/save without auth → 401', (await post('/api/nodes/00000000-0000-4000-8000-000000000001/save')).status === 401)
  check('/save with read-only auth → 403', (await post('/api/nodes/00000000-0000-4000-8000-000000000001/save', { Authorization: READER })).status === 403)
  // Writer is authorized, but no document is loaded (no WS session) → 404
  check('/save with writer auth, doc not loaded → 404', (await post('/api/nodes/00000000-0000-4000-8000-000000000001/save', { Authorization: WRITER })).status === 404)

  // F-02: /autosave requires the same gate
  check('/autosave without auth → 401', (await post('/api/nodes/00000000-0000-4000-8000-000000000001/autosave', {}, { enabled: false })).status === 401)
  check('/autosave with read-only auth → 403', (await post('/api/nodes/00000000-0000-4000-8000-000000000001/autosave', { Authorization: READER }, { enabled: false })).status === 403)

  // F-08: login returns an opaque server-side session token, not credentials
  const loginRes = await post('/api/login', {}, { username: 'writer', password: 'pw' })
  const login = await loginRes.json()
  const basicOfCreds = Buffer.from('writer:pw').toString('base64')
  check('login succeeds', loginRes.status === 200, `status=${loginRes.status}`)
  check('session token is NOT the base64 credentials', login.token && login.token !== basicOfCreds)

  // Bearer session works on the mutation gate (writer → 404 doc-not-loaded)
  const bearer = { Authorization: `Bearer ${login.token}` }
  check('/save with writer session → 404 (auth ok, doc not loaded)',
    (await post('/api/nodes/00000000-0000-4000-8000-000000000001/save', bearer)).status === 404)

  // Reader session gets 403
  const readerLogin = await (await post('/api/login', {}, { username: 'reader', password: 'pw' })).json()
  check('/save with reader session → 403',
    (await post('/api/nodes/00000000-0000-4000-8000-000000000001/save', { Authorization: `Bearer ${readerLogin.token}` })).status === 403)

  // Logout revokes the session
  check('logout → 204', (await post('/api/logout', bearer)).status === 204)
  check('/save with revoked session → 401', (await post('/api/nodes/00000000-0000-4000-8000-000000000001/save', bearer)).status === 401)

  // Ticket login (edu-sharing embedding): {ticket} instead of username/password
  const ticketRes = await post('/api/login', {}, { ticket: 'valid-ticket-123' })
  const ticketLogin = await ticketRes.json()
  check('ticket login succeeds', ticketRes.status === 200, `status=${ticketRes.status}`)
  check('ticket session token is opaque', Boolean(ticketLogin.token) && !ticketLogin.token.includes('valid-ticket'))
  check('/save with ticket session → 404 (auth ok, doc not loaded)',
    (await post('/api/nodes/00000000-0000-4000-8000-000000000001/save', { Authorization: `Bearer ${ticketLogin.token}` })).status === 404)
  check('invalid ticket → 401', (await post('/api/login', {}, { ticket: 'wrong' })).status === 401)

  // F-05: login rate limit (max 6 per window in this test config; the four
  // login attempts above already consumed four slots)
  const codes = []
  for (let i = 0; i < 3; i++) {
    codes.push((await post('/api/login', {}, { username: 'writer', password: 'wrong' })).status)
  }
  check('remaining attempts reach edu-sharing (401)', codes[0] === 401 && codes[1] === 401, JSON.stringify(codes))
  check('further attempts are rate-limited (429)', codes[2] === 429, JSON.stringify(codes))
} finally {
  server.kill()
  mock.close()
}

process.exit(fail ? 1 : 0)
