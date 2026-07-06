/**
 * Demo host page (left column). Plays the role the edu-sharing Angular UI
 * will take over later: holds the user session (opaque server-side token,
 * audit F-08), passes document-name + token into the <md-collab-editor>
 * component (right column) and displays status/save state. The component
 * itself knows nothing about edu-sharing.
 *
 * Save status is driven by the component's `save-state-change` events
 * (real-time broadcasts, audit P-01); the REST API is only polled slowly
 * for node metadata (title, permissions).
 *
 * Backend location: by default the collab server is same-origin (all-in-one
 * Docker deployment). If the page/component is ever served from a different
 * origin than the collab server, set `window.APP_CONFIG.backendBase` in
 * public/app-config.js — API calls and the WebSocket URL are derived from it.
 */
const $ = (sel) => document.querySelector(sel)

// '' = same origin; otherwise e.g. 'https://collab.example.org'
const BACKEND_BASE = (window.APP_CONFIG?.backendBase || '').replace(/\/$/, '')
const WS_URL = BACKEND_BASE ? BACKEND_BASE.replace(/^http/, 'ws') + '/collab' : ''
const NODE_INFO_POLL_MS = 30000

/** fetch against the collab server (same origin or configured backend). */
function api(path, options) {
  return fetch(BACKEND_BASE + path, options)
}

// Currently opened document + latest known state
let current = null   // {nodeId, field, documentName}
let nodeInfo = null  // slow-polled node metadata from the REST API
let liveSave = null  // real-time save state from the component broadcast
let statusTimer = null

// Session in sessionStorage: only the OPAQUE token, never credentials (F-08)
const session = {
  get token() { return sessionStorage.getItem('wlo_token') || '' },
  get name() { return sessionStorage.getItem('wlo_name') || '' },
  set({ token, name }) {
    sessionStorage.setItem('wlo_token', token)
    sessionStorage.setItem('wlo_name', name)
  },
  clear() {
    sessionStorage.removeItem('wlo_token')
    sessionStorage.removeItem('wlo_name')
  },
}

function authHeaders() {
  return session.token ? { Authorization: `Bearer ${session.token}` } : {}
}

// --------------------------------------------------------------- Login ---
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const user = $('#l-user').value.trim()
  const pass = $('#l-pass').value
  const msg = $('#login-msg')
  msg.textContent = 'Prüfe Anmeldung …'
  try {
    const res = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Anmeldung fehlgeschlagen')
    session.set({ token: data.token, name: data.displayName || user })
    msg.textContent = ''
    updateLoginBox()
    // Reconnect the editor with the new session if a document is open
    if (current) openDocument(current.nodeId, current.field)
  } catch (err) {
    msg.textContent = `✗ ${err.message}`
  }
})

$('#logout-btn').addEventListener('click', async () => {
  // Revoke the server-side session, then drop the local handle
  await api('/api/logout', { method: 'POST', headers: authHeaders() }).catch(() => {})
  session.clear()
  updateLoginBox()
  if (current) openDocument(current.nodeId, current.field)
})

function updateLoginBox() {
  const loggedIn = Boolean(session.token)
  $('#login-form').hidden = loggedIn
  $('#login-state').hidden = !loggedIn
  if (loggedIn) {
    $('#login-who').textContent = session.name
    if (!$('#f-name').value) $('#f-name').value = session.name
  }
}

// ------------------------------------------------------- Node selection ---
$('#open-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const id = $('#f-nodeid').value.trim()
  if (!id) return
  const field = document.querySelector('input[name="f-field"]:checked')?.value || ''
  openDocument(id, field)
})

// -------------------------------------------------------------- Editor ---
function openDocument(nodeId, field) {
  const documentName = field ? `${nodeId}:${field}` : nodeId
  current = { nodeId, field, documentName }
  nodeInfo = null
  liveSave = null

  // Keep the URL shareable (multi-user testing)
  const userName = $('#f-name').value.trim() || session.name || 'Anonym'
  const q = new URLSearchParams({ nodeId, ...(field && { field }), name: userName })
  history.replaceState(null, '', `?${q}`)
  $('#share-url').textContent = `${location.origin}/?nodeId=${nodeId}${field ? `&field=${field}` : ''}`
  $('#share-hint').hidden = false

  // Dispose the old component (disconnects provider + editor), mount a new
  // one — exactly what the Angular page would do as well
  const slot = $('#editor-slot')
  slot.innerHTML = ''
  $('#editor-empty').hidden = true
  const el = document.createElement('md-collab-editor')
  el.setAttribute('document-name', documentName)
  el.setAttribute('user-name', userName)
  if (WS_URL) el.setAttribute('websocket-url', WS_URL)
  if (session.token) el.setAttribute('token', session.token)
  slot.appendChild(el)

  el.addEventListener('status-change', (e) => {
    const s = e.detail.status
    const conn = $('#conn')
    conn.dataset.state = s
    conn.textContent = { connected: 'verbunden', connecting: 'verbinde …', disconnected: 'getrennt' }[s] || s
  })

  // Real-time save state from the server broadcast — replaces fast polling (P-01)
  el.addEventListener('save-state-change', (e) => {
    liveSave = e.detail
    renderStatus()
  })

  // Example host-side hooks: the Angular page could use these events for
  // its own preview/persistence — presence itself is rendered by the component
  el.addEventListener('users-change', (e) => {
    window.__users = e.detail.users
  })
  el.addEventListener('markdown-change', (e) => {
    window.__lastMarkdown = e.detail.markdown
  })

  $('#doc-panel').hidden = false
  $('#doc-id').textContent = nodeId
  $('#doc-title').textContent = 'Lade …'
  clearInterval(statusTimer)
  refreshNodeInfo()
  statusTimer = setInterval(refreshNodeInfo, NODE_INFO_POLL_MS)
}

// -------------------------------------------------------------- Status ---
/** Slow poll: node metadata (title, permissions, block reason). */
async function refreshNodeInfo() {
  if (!current) return
  try {
    const q = current.field ? `?field=${current.field}` : ''
    const res = await api(`/api/nodes/${encodeURIComponent(current.nodeId)}${q}`, { headers: authHeaders() })
    nodeInfo = await res.json()
    renderStatus()
  } catch {
    /* server briefly unreachable — the next poll retries */
  }
}

/** Merge slow node info + live save state into the sidebar display. */
function renderStatus() {
  const info = nodeInfo
  if (info?.error) {
    $('#doc-title').textContent = 'Knoten nicht erreichbar'
    setSaveState('error', info.error)
    return
  }
  if (info) {
    $('#doc-title').textContent = info.title
    const renderLink = $('#render-link')
    renderLink.href = info.renderUrl
    renderLink.hidden = false
    $('#doc-target').textContent = info.targetLabel ? `Speicherziel: ${info.targetLabel}` : ''
  }

  const s = liveSave
  const canPersist = s ? s.canPersist : Boolean(info?.canWrite)
  $('#autosave-toggle').checked = s ? s.autosave : (info?.autosave ?? true)
  $('#save-now').disabled = !canPersist || !(s?.dirty)
  $('#autosave-warn').hidden = (s ? s.autosave : true) || !canPersist

  if (info?.contentBlocked) {
    setSaveState('blocked', info.blockReason || 'Bearbeitung für diesen Knoten nicht möglich.')
  } else if (!canPersist) {
    setSaveState('readonly', session.token
      ? 'Nur-Lesen: dein Account hat kein Schreibrecht auf diesen Knoten.'
      : 'Nur-Lesen: ohne Anmeldung werden Änderungen nicht gespeichert.')
  } else if (s?.error) {
    setSaveState('error', `Speicherfehler: ${s.error}`)
  } else if (s?.dirty && !s.autosave) {
    setSaveState('pending', 'Ungespeicherte Änderungen im Puffer — Auto-Speichern ist aus, „Jetzt speichern" nutzen.')
  } else if (s?.dirty) {
    const secs = Math.round((s.debounce || 15000) / 1000)
    setSaveState('pending', `Änderungen im Puffer — Speicherung folgt automatisch (~${secs}s nach der letzten Eingabe, sofort beim Verlassen).`)
  } else if (s?.lastSavedAt) {
    const t = new Date(s.lastSavedAt).toLocaleTimeString('de-DE')
    setSaveState('saved', `Gespeichert ins Repo um ${t}.`)
  } else {
    setSaveState('idle', 'Stand aus dem Repo geladen — Änderungen werden gepuffert und automatisch gespeichert.')
  }
}

function setSaveState(state, text) {
  const el = $('#save-state')
  el.dataset.state = state
  el.textContent = text
  $('#save-led').dataset.state = state // control LED mirrors the state
}

// -------------------------------------- Autosave toggle / save now ---
$('#autosave-toggle').addEventListener('change', async (e) => {
  if (!current) return
  const q = current.field ? `?field=${current.field}` : ''
  await api(`/api/nodes/${encodeURIComponent(current.nodeId)}/autosave${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ enabled: e.target.checked }),
  }).catch(() => {})
})

$('#save-now').addEventListener('click', async () => {
  if (!current) return
  const btn = $('#save-now')
  btn.disabled = true
  btn.textContent = 'Speichere …'
  const q = current.field ? `?field=${current.field}` : ''
  await api(`/api/nodes/${encodeURIComponent(current.nodeId)}/save${q}`, {
    method: 'POST',
    headers: authHeaders(),
  }).catch(() => {})
  btn.textContent = 'Jetzt speichern'
  renderStatus() // final state arrives via save-state-change broadcast
})

// --------------------------------------------------------------- Start ---
async function start() {
  updateLoginBox()
  const params = new URLSearchParams(location.search)

  // Embedding flow: an edu-sharing page can pass its ticket via ?ticket=…
  // → exchanged for a session, then removed from the URL
  const ticket = params.get('ticket')
  if (ticket && !session.token) {
    try {
      const res = await api('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket }),
      })
      const data = await res.json()
      if (res.ok) {
        session.set({ token: data.token, name: data.displayName || 'Ticket-Nutzer' })
        updateLoginBox()
      } else {
        $('#login-msg').textContent = `✗ ${data.error || 'Ticket-Anmeldung fehlgeschlagen'}`
      }
    } catch { /* offline — interactive login remains available */ }
    params.delete('ticket')
    history.replaceState(null, '', `?${params}`)
  }

  const urlNode = (params.get('nodeId') || '').trim()
  if (urlNode) {
    $('#f-nodeid').value = urlNode
    if (params.get('name')) $('#f-name').value = params.get('name')
    const urlField = params.get('field') === 'description' ? 'description' : ''
    const radio = document.querySelector(`input[name="f-field"][value="${urlField}"]`)
    if (radio) radio.checked = true
    openDocument(urlNode, urlField)
  }
}
start()
