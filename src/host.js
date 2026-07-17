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
import { t, detectLang, setLang } from './i18n.js'

const $ = (sel) => document.querySelector(sel)

// UI language: persisted in localStorage, applied once on load. Changing it
// reloads the page (see the #lang-switch listener) — simpler and more
// robust than live-reactive text swapping for a page with this much
// server-driven/dynamic content.
const lang = detectLang()

// '' = same origin; otherwise e.g. 'https://collab.example.org'
const BACKEND_BASE = (window.APP_CONFIG?.backendBase || '').replace(/\/$/, '')
const WS_URL = BACKEND_BASE ? BACKEND_BASE.replace(/^http/, 'ws') + '/collab' : ''
const NODE_INFO_POLL_MS = 30000

/** Apply translations to the static markup (public/index.html) once on load. */
function applyStaticTranslations() {
  document.documentElement.lang = lang
  for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(lang, el.dataset.i18n)
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(lang, el.dataset.i18nTitle)
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(lang, el.dataset.i18nPlaceholder)
  const langSwitch = $('#lang-switch')
  langSwitch.value = lang
  langSwitch.addEventListener('change', () => {
    setLang(langSwitch.value)
    location.reload()
  })
}
applyStaticTranslations()

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
  msg.textContent = t(lang, 'host.loginChecking')
  try {
    const res = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || t(lang, 'host.loginFailedDefault'))
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
  // Revoke the server-side session, then drop the local handle. The editor
  // is closed rather than reopened read-only/anonymous — logging out ends
  // the session, it should not silently fall back to viewing.
  await api('/api/logout', { method: 'POST', headers: authHeaders() }).catch(() => {})
  session.clear()
  updateLoginBox()
  closeDocument()
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
  const userName = $('#f-name').value.trim() || session.name || t(lang, 'host.anonymousName')
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
  el.setAttribute('lang', lang)
  if (WS_URL) el.setAttribute('websocket-url', WS_URL)
  if (session.token) el.setAttribute('token', session.token)
  $('#viewer-toggle').checked = false // fresh mount starts in edit view

  // Image upload → child-IO under the node (server proxies edu-sharing)
  el.uploadImage = async (file) => {
    const res = await api(
      `/api/nodes/${encodeURIComponent(current.nodeId)}/images?filename=${encodeURIComponent(file.name)}`,
      { method: 'POST', headers: { 'Content-Type': file.type, ...authHeaders() }, body: file },
    )
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
    return (await res.json()).url
  }

  // Node comments (edu-sharing comment API, proxied with the session)
  el.commentsApi = {
    list: async () => {
      const res = await api(`/api/nodes/${encodeURIComponent(current.nodeId)}/comments`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).comments
    },
    add: async (text, replyTo) => {
      const res = await api(`/api/nodes/${encodeURIComponent(current.nodeId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text, replyTo }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },
    remove: async (id) => {
      const res = await api(`/api/comments/${encodeURIComponent(id)}`,
        { method: 'DELETE', headers: authHeaders() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },
  }
  // Media management: uploaded editor images (mdimg child-IOs under the node)
  el.mediaApi = {
    list: async () => {
      const res = await api(`/api/nodes/${encodeURIComponent(current.nodeId)}/images`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).images
    },
    remove: async (id) => {
      const res = await api(`/api/nodes/${encodeURIComponent(current.nodeId)}/images/${encodeURIComponent(id)}`,
        { method: 'DELETE', headers: authHeaders() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    },
  }
  slot.appendChild(el)

  // Deep link: #slug in the URL jumps to the heading once the doc is synced
  el.addEventListener('synced', () => {
    if (location.hash.length > 1) el.jumpToAnchor(decodeURIComponent(location.hash.slice(1)))
  }, { once: true })

  el.addEventListener('status-change', (e) => {
    const s = e.detail.status
    const conn = $('#conn')
    conn.dataset.state = s
    conn.textContent = {
      connected: t(lang, 'host.connConnected'),
      connecting: t(lang, 'host.connConnecting'),
      disconnected: t(lang, 'host.connDisconnected'),
      'session-expired': t(lang, 'host.connSessionExpired'),
    }[s] || s
    // Expired/revoked session: drop the dead local token so the login box
    // reappears instead of silently retrying with it on the next document
    if (s === 'session-expired') {
      session.clear()
      updateLoginBox()
    }
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
  $('#doc-title').textContent = t(lang, 'host.loading')
  clearInterval(statusTimer)
  refreshNodeInfo()
  statusTimer = setInterval(refreshNodeInfo, NODE_INFO_POLL_MS)
}

/**
 * Tear down the open document: disposes the <md-collab-editor> (disconnects
 * provider + editor, same as swapping documents), resets the sidebar to its
 * initial state and drops the shareable URL. Used on logout — no read-only
 * fallback view, the session end must actually stop further interaction.
 */
function closeDocument() {
  current = null
  nodeInfo = null
  liveSave = null
  clearInterval(statusTimer)
  statusTimer = null
  $('#editor-slot').innerHTML = ''
  $('#editor-empty').hidden = false
  $('#doc-panel').hidden = true
  $('#share-hint').hidden = true
  history.replaceState(null, '', location.pathname)
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
    $('#doc-title').textContent = t(lang, 'host.nodeUnreachable')
    setSaveState('error', info.error)
    return
  }
  if (info) {
    $('#doc-title').textContent = info.title
    const renderLink = $('#render-link')
    renderLink.href = info.renderUrl
    renderLink.hidden = false
    // Compose the save-target label client-side (the server's targetLabel
    // string is German-only) — info.mode + info.type carry the raw facts
    const targetLabel = info.mode === 'description'
      ? t(lang, 'host.targetDescriptionLabel')
      : info.mode === 'compendium'
        ? t(lang, 'host.targetCompendiumLabel', { type: info.type })
        : ''
    $('#doc-target').textContent = targetLabel ? t(lang, 'host.saveTarget', { label: targetLabel }) : ''
  }

  const s = liveSave
  const canPersist = s ? s.canPersist : Boolean(info?.canWrite)
  $('#autosave-toggle').checked = s ? s.autosave : (info?.autosave ?? true)
  $('#save-now').disabled = !canPersist || !(s?.dirty)
  $('#autosave-warn').hidden = (s ? s.autosave : true) || !canPersist

  if (info?.contentBlocked) {
    setSaveState('blocked', info.blockReason || t(lang, 'host.blockedDefault'))
  } else if (!canPersist) {
    setSaveState('readonly', session.token
      ? t(lang, 'host.readonlyWithAccount')
      : t(lang, 'host.readonlyNoAccount'))
  } else if (s?.error) {
    setSaveState('error', t(lang, 'host.saveErrorPrefix', { err: s.error }))
  } else if (s?.dirty && !s.autosave) {
    setSaveState('pending', t(lang, 'host.pendingNoAutosave'))
  } else if (s?.dirty) {
    const secs = Math.round((s.debounce || 15000) / 1000)
    setSaveState('pending', t(lang, 'host.pendingAutosave', { secs }))
  } else if (s?.lastSavedAt) {
    const time = new Date(s.lastSavedAt).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'de-DE')
    setSaveState('saved', t(lang, 'host.savedAt', { time }))
  } else {
    setSaveState('idle', t(lang, 'host.idleLoaded'))
  }
}

function setSaveState(state, text) {
  const el = $('#save-state')
  el.dataset.state = state
  el.textContent = text
  $('#save-led').dataset.state = state // control LED mirrors the state
}

// Viewer mode: drives the component's externally controllable `viewer`
// attribute (read view without the toolbar) — here wired to a demo switch
$('#viewer-toggle').addEventListener('change', (e) => {
  const el = $('#editor-slot md-collab-editor')
  if (el) el.setAttribute('viewer', e.target.checked ? 'true' : 'false')
})

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
  btn.textContent = t(lang, 'host.saveNowSaving')
  const q = current.field ? `?field=${current.field}` : ''
  await api(`/api/nodes/${encodeURIComponent(current.nodeId)}/save${q}`, {
    method: 'POST',
    headers: authHeaders(),
  }).catch(() => {})
  btn.textContent = t(lang, 'host.saveNowIdle')
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
        session.set({ token: data.token, name: data.displayName || t(lang, 'host.ticketUserName') })
        updateLoginBox()
      } else {
        $('#login-msg').textContent = `✗ ${data.error || t(lang, 'host.ticketLoginFailedDefault')}`
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
