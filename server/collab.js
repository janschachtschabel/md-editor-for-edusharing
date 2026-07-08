/**
 * Collaboration layer: Hocuspocus server (Yjs), per-document runtime state,
 * buffered persistence to the repository with read-back verification.
 *
 * Sync strategy: Yjs synchronizes users in real time, the repository is pure
 * persistence. Repo writes run debounced (SAVE_DEBOUNCE_MS /
 * SAVE_MAX_DEBOUNCE_MS), immediately on a "save" command, and immediately
 * when the last client disconnects (the document is then unloaded — the next
 * opener loads fresh from the repository).
 */
import { Hocuspocus } from '@hocuspocus/server'
import { TiptapTransformer } from '@hocuspocus/transformer'
import { generateHTML, generateJSON } from '@tiptap/html'
import * as Y from 'yjs'
import { createExtensions } from '../src/extensions.js'
import { markdownToHtml, htmlToMarkdown } from '../src/markdown.js'
import {
  ALLOW_ANONYMOUS_EDIT, ENV_AUTH,
  SAVE_DEBOUNCE_MS, SAVE_MAX_DEBOUNCE_MS, SAVE_RETRY_MS,
} from './config.js'
import {
  getNodeInfo, loadMarkdown, saveKeywords, saveMarkdown, parseDocumentName,
} from './edu-sharing-api.js'
import { annotationsToKeywords, keywordsToAnnotations } from '../src/annotations.js'
import { resolveAuthToken } from './sessions.js'

const extensions = createExtensions()

/** Runtime state per document (also read by the status API). */
export const docState = new Map() // documentName → {title, mode, dirty, lastSavedAt, …}
/** Last valid user auth per document — used for loading/saving. */
export const docAuth = new Map() // documentName → Basic auth header

/**
 * Last known Yjs state per document, kept across the unload/reload cycle
 * (i.e. it survives all clients disconnecting, but not a server restart).
 *
 * Why this is needed: onLoadDocument used to always rebuild a Y.Doc from the
 * repository's markdown on every load. A rebuilt doc is a structurally NEW
 * Y.Doc — even with identical text — because Yjs identifies insertions by
 * (clientID, clock), not by content. If a client's local doc was still
 * "live" (e.g. a brief WebSocket reconnect, not a full page reload) while
 * the server had unloaded and later rebuilt the document, merging the two
 * duplicated every insertion: text AND entity annotations appeared twice.
 * Restoring the exact previous Yjs state via applyUpdate is idempotent with
 * an already-live client and avoids this. The cached markdown lets us
 * detect an external edit (repo changed while nobody had the doc open) and
 * fall back to a fresh rebuild in that case — safe because no live client
 * exists then to duplicate against.
 */
const docSnapshots = new Map() // documentName → {update: Uint8Array, markdown: string}

export function resolveAuth(documentName) {
  return docAuth.get(documentName) ?? ENV_AUTH ?? null
}

// --------------------------------------------------- Markdown ⇄ Yjs doc ---
function markdownToYdoc(markdown) {
  const html = markdownToHtml(markdown)
  const json = generateJSON(html, extensions)
  return TiptapTransformer.toYdoc(json, 'default', extensions)
}

function ydocToMarkdown(document) {
  const json = TiptapTransformer.fromYdoc(document, 'default')
  const html = generateHTML(json, extensions)
  return htmlToMarkdown(html)
}

// ------------------------------------------------------------ Broadcast ---
/** Compare keyword lists; `unordered` ignores order (repo may reorder values). */
function sameList(a, b, unordered = false) {
  const x = unordered ? [...(a || [])].sort() : (a || [])
  const y = unordered ? [...(b || [])].sort() : (b || [])
  return x.length === y.length && x.every((v, i) => v === y[i])
}

/** Stateless broadcast to all connected clients of a document. */
function broadcast(document, obj) {
  try { document.broadcastStateless(JSON.stringify(obj)) } catch { /* doc may already be unloaded */ }
}

/** Announce save/config state to all clients (save display + countdown). */
export function broadcastConfig(documentName, document) {
  const state = docState.get(documentName)
  if (!state || !document) return
  broadcast(document, {
    event: 'config',
    saveDebounceMs: SAVE_DEBOUNCE_MS,
    saveMaxDebounceMs: SAVE_MAX_DEBOUNCE_MS,
    autosave: state.autosave,
    dirty: state.dirty,
    lastSavedAt: state.lastSavedAt,
    canPersist: Boolean(resolveAuth(documentName)) && !state.contentBlocked && state.canRepoWrite,
  })
}

// ---------------------------------------------------------- Persistence ---
/**
 * Shared save logic for onStoreDocument, error retry and the "save" command.
 * Broadcasts the result to all clients.
 * @param {boolean} [manual] true = explicit user action (overrides the
 *   autosave switch and also reports precondition failures)
 */
export async function persistDocument(documentName, document, manual = false) {
  const state = docState.get(documentName)
  const markdown = ydocToMarkdown(document)
  // Snapshot the live Yjs state on every store attempt (this also runs
  // immediately before the document is unloaded) — see docSnapshots above.
  if (state) docSnapshots.set(documentName, { update: Y.encodeStateAsUpdate(document), markdown })
  if (!state || state.contentBlocked) {
    if (manual) broadcast(document, { event: 'save-error', message: 'Dieser Knoten kann nicht bearbeitet werden.' })
    return
  }
  // Autosave disabled: only manual saving writes to the repo, changes stay
  // in the Yjs buffer (dirty)
  if (!state.autosave && !manual) return
  const auth = resolveAuth(documentName)
  if (!auth) {
    if (manual) broadcast(document, { event: 'save-error', message: 'Keine Schreib-Session — bitte anmelden.' })
    return
  }
  // IMPORTANT: edu-sharing answers PUT /metadata WITHOUT write permission
  // with 200 OK and drops silently (verified 07/2026) — check access explicitly
  if (!state.canRepoWrite) {
    if (manual) broadcast(document, { event: 'save-error', message: 'Der angemeldete Account hat kein Schreibrecht auf diesen Knoten.' })
    return
  }
  // Entity annotations (shared Y.Array) → general keywords "Name (Typ)";
  // plain keywords from the repository are preserved
  const keywords = annotationsToKeywords(document.getArray('annotations').toArray(), state.lastSavedKeywords)
  const markdownChanged = markdown !== state.lastSavedMarkdown
  const keywordsChanged = !sameList(keywords, state.lastSavedKeywords)
  // Change detection: an identical state (e.g. formatting without markdown
  // effect, cursor moves) produces no repo write
  if (!markdownChanged && !keywordsChanged) {
    state.dirty = false
    broadcast(document, { event: 'saved', at: state.lastSavedAt, noop: true })
    return
  }
  try {
    if (markdownChanged) await saveMarkdown(state.writeTarget, state.mode, markdown, auth)
    if (keywordsChanged) await saveKeywords(state.writeTarget, keywords, auth)
    // Read-back verification: edu-sharing can return 200 and still drop
    // silently — "saved" is only reported after a confirmed read-back
    const { field } = parseDocumentName(documentName)
    const verify = await getNodeInfo(state.writeTarget, field, auth)
    const markdownOk = !markdownChanged || loadMarkdown(verify) === markdown
    const keywordsOk = !keywordsChanged || sameList(verify.keywords, keywords, true)
    if (!markdownOk || !keywordsOk) {
      state.lastError = 'Repo hat die Änderung nicht übernommen (Antwort 200, aber nichts gespeichert) — Schreibrecht bzw. Property-Definition prüfen.'
      console.error(`[save] VERIFICATION FAILED ${documentName} → ${state.writeTarget} [${state.mode}] (markdown ${markdownOk ? 'ok' : 'FAILED'}, keywords ${keywordsOk ? 'ok' : 'FAILED'})`)
      broadcast(document, { event: 'save-error', message: state.lastError })
      return // deterministic failure — no retry
    }
    state.lastSavedMarkdown = markdown
    state.lastSavedKeywords = keywords
    state.lastSavedAt = new Date().toISOString()
    state.lastError = null
    state.dirty = false
    console.log(`[save] ${documentName} → ${state.writeTarget} [${state.mode}] (${markdown.length} chars, ${keywords.length} keywords, verified)`)
    broadcast(document, { event: 'saved', at: state.lastSavedAt })
  } catch (err) {
    state.lastError = err.message
    console.error(`[save] ERROR ${documentName}: ${err.message} — retry in ${SAVE_RETRY_MS / 1000}s`)
    broadcast(document, { event: 'save-error', message: err.message })
    // Retry in case no further changes arrive (otherwise the failed state
    // would never be saved)
    clearTimeout(state.retryTimer)
    state.retryTimer = setTimeout(() => {
      const doc = hocuspocus.documents.get(documentName)
      if (doc) persistDocument(documentName, doc)
    }, SAVE_RETRY_MS)
  }
}

// ------------------------------------------------------------ Hocuspocus ---
export const hocuspocus = new Hocuspocus({
  quiet: true,
  debounce: SAVE_DEBOUNCE_MS,
  maxDebounce: SAVE_MAX_DEBOUNCE_MS,

  /** Token = opaque session token from /api/login (or "anonymous"). */
  async onAuthenticate({ token, documentName, connectionConfig }) {
    if (!token || token === 'anonymous') {
      if (!ALLOW_ANONYMOUS_EDIT && !ENV_AUTH) connectionConfig.readOnly = true
      return {}
    }
    const { nodeId, field } = parseDocumentName(documentName)
    const { authHeader, session } = resolveAuthToken(token)
    if (!authHeader) {
      // Unknown/expired session: allow the connection, but read-only
      connectionConfig.readOnly = true
      return {}
    }
    const who = { authorityName: session?.authorityName || 'api-client' }

    // Determine write permission on this node. Only write-capable users may
    // edit the shared Yjs document AND become the repository write session —
    // otherwise a read-only user's edits would be persisted under someone
    // else's identity (audit F-03).
    let canWrite = false
    try {
      const info = await getNodeInfo(nodeId, field, authHeader)
      canWrite = (info.access || []).includes('Write')
    } catch { /* upstream error → treat as no write, stay read-only */ }

    if (!canWrite) {
      connectionConfig.readOnly = true
      console.log(`[auth] ${who.authorityName} logged in for ${documentName} (read-only, no write access)`)
      return { user: who }
    }

    docAuth.set(documentName, authHeader)
    const state = docState.get(documentName)
    if (state) state.canRepoWrite = true
    const doc = hocuspocus.documents.get(documentName)
    if (doc) broadcastConfig(documentName, doc)
    console.log(`[auth] ${who.authorityName} logged in for ${documentName} (write access)`)
    return { authHeader, user: who }
  },

  async onLoadDocument({ documentName, document }) {
    const { nodeId, field } = parseDocumentName(documentName)
    const auth = resolveAuth(documentName)
    const info = await getNodeInfo(nodeId, field, auth)
    // Preload the existing text from the repository (compendium property or
    // description — depending on mode)
    const markdown = loadMarkdown(info)
    docState.set(documentName, {
      title: info.title,
      mode: info.mode,
      contentBlocked: info.contentBlocked,
      canRepoWrite: (info.access || []).includes('Write'),
      writeTarget: info.originalId || nodeId,
      lastSavedMarkdown: markdown, // baseline for change detection
      lastSavedKeywords: info.keywords || [], // baseline incl. plain keywords
      lastSavedAt: null,
      lastChangedAt: null,
      lastError: null,
      dirty: false,
      autosave: true,
      retryTimer: null,
    })
    // Only seed initially — if the Yjs doc already has content, don't overwrite.
    if (document.getXmlFragment('default').length > 0) return document

    // Prefer the last known Yjs state for this document over rebuilding one
    // from markdown — see docSnapshots for why a rebuild can duplicate
    // content on a reconnect. Only reuse it while the repo text still
    // matches what we last saw (otherwise the repo was edited externally
    // while unloaded — safe to rebuild fresh since no live client exists then).
    const snapshot = docSnapshots.get(documentName)
    if (snapshot && snapshot.markdown === markdown) {
      Y.applyUpdate(document, snapshot.update)
      console.log(`[load] ${documentName} "${info.title}" — restored from cached Yjs state (reconnect, no rebuild)`)
      return document
    }

    const ydoc = markdownToYdoc(markdown)
    // Re-anchor stored entity keywords ("Name (Typ)") as annotations via
    // quote search in the text — entities whose quote is gone are skipped
    const annotations = keywordsToAnnotations(info.keywords || [], markdown)
    if (annotations.length) ydoc.getArray('annotations').push(annotations)
    console.log(`[load] ${documentName} "${info.title}" — mode ${info.mode}, ${markdown.length} chars, ${annotations.length} entities preloaded`)
    return ydoc
  },

  /** Fires on every change (no debounce) — only maintains the buffer state. */
  async onChange({ documentName }) {
    const state = docState.get(documentName)
    if (state) {
      state.dirty = true
      state.lastChangedAt = new Date().toISOString()
    }
  },

  /** Debounced (SAVE_DEBOUNCE_MS / SAVE_MAX_DEBOUNCE_MS) + immediate on last disconnect. */
  async onStoreDocument({ documentName, document }) {
    await persistDocument(documentName, document)
  },

  /** Commands from the editor component over the collaboration channel. */
  async onStateless({ payload, document, documentName }) {
    let msg
    try { msg = JSON.parse(payload) } catch { return }
    if (msg.event === 'save') {
      // "Save" click of one user → persist immediately, the result is
      // broadcast to ALL clients (shared repo state)
      await persistDocument(documentName, document, true)
    } else if (msg.event === 'hello') {
      // A freshly connected client asks for the save state
      broadcastConfig(documentName, document)
    }
  },

  /**
   * After Hocuspocus unloads the document (last client gone), drop the
   * external per-document state so the maps don't grow without bound and
   * credentials don't linger in memory (audit F-04).
   */
  async afterUnloadDocument({ documentName }) {
    const state = docState.get(documentName)
    if (state?.retryTimer) clearTimeout(state.retryTimer)
    docState.delete(documentName)
    docAuth.delete(documentName)
  },
})
