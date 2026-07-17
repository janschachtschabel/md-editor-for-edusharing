/**
 * AI auto-tagging — cleanly encapsulated from the rest of the editor code.
 *
 * On request (🤖 button → stateless "ai-tag" message, wired in collab.js) the
 * AI joins the document as a visible collaborative participant (awareness
 * presence chip), reads the current markdown, asks the B-API (OpenAI
 * passthrough, see server/config.js) for
 *   - inline ENTITIES  (exact quote + type)   → pushed into the shared
 *     Y.Array('annotations') → pills/decorations update on every client
 *   - paragraph ROLES  (exact quote + slug)   → the matching block is wrapped
 *     in a roleBlock directly in the shared Y.Doc → ::: markup + role chips
 * and leaves again. All suggestions are validated exactly like human input:
 * hallucinated quotes, crossing spans, duplicates and invalid types/slugs are
 * dropped silently (the model is untrusted input).
 *
 * The API key stays server-side only; clients never talk to the model.
 */
import { randomUUID } from 'node:crypto'
import * as Y from 'yjs'
import { AI_API_KEY, AI_BASE_URL, AI_COOLDOWN_MS, AI_MODEL, AI_TIMEOUT_MS } from './config.js'
import {
  findQuoteRange, isCrossing, isValidQuote, isValidType, resolveAnnotations,
} from '../src/annotations.js'
import { DEFAULT_BLOCK_ROLES, DEFAULT_TYPE_GROUPS, roleSlug } from '../src/entity-types.js'
import { markdownToPlainText } from '../src/markdown.js'

/** True when an API key is available (feature is otherwise hidden/disabled). */
export function aiConfigured() {
  return Boolean(AI_API_KEY)
}

/** Presence identity the AI uses while it works in the document. */
const AI_USER = { name: '🤖 KI-Tagger', color: '#7b1fa2' }

/** One tagging run per document at a time. */
const running = new Set()

/**
 * End time of the last run per document — cost brake (audit P-1): a new run
 * is only accepted AI_COOLDOWN_MS after the previous one finished. Expired
 * entries are purged on every write so the map cannot grow without bound.
 */
const lastRunAt = new Map()
function rememberRun(documentName) {
  const now = Date.now()
  for (const [name, at] of lastRunAt) {
    if (now - at >= AI_COOLDOWN_MS) lastRunAt.delete(name)
  }
  lastRunAt.set(documentName, now)
}

// ------------------------------------------------------------- Broadcast ---
function notify(document, obj) {
  try { document.broadcastStateless(JSON.stringify({ event: 'ai-status', ...obj })) } catch { /* doc gone */ }
}

// ------------------------------------------------------------ Model call ---
function buildPrompt(markdown, existingEntities) {
  const types = DEFAULT_TYPE_GROUPS.flatMap((g) => g.types).join(', ')
  const roles = DEFAULT_BLOCK_ROLES.map((r) => r.slug).join(', ')
  const existing = existingEntities.map((a) => `${a.quote} (${a.type})`).join('; ') || '—'
  return [
    {
      role: 'system',
      content: `Du bist ein Verschlagwortungs-Assistent für deutsche Lehrtexte (Markdown).
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt: {"entities": [{"quote","type"}], "roles": [{"quote","role","endQuote"?}]}.

ENTITÄTEN (inline): Erkenne bedeutungstragende Entitäten im Fließtext.
- "quote" ist ein EXAKTES, wörtliches Zitat aus dem Text (max. 200 Zeichen, kein Zeilenumbruch, keine Markdown-Syntax).
- "quote" ist die KÜRZESTE Wortgruppe, die die Entität exakt benennt — NUR der Eigenname/Begriff selbst, keine umgebenden Wörter.
  Richtig: "Christoph Kolumbus" · Falsch: "Entdeckungsreisen von Christoph Kolumbus".
- "type" bevorzugt aus diesem Katalog: ${types}. Freie Typen erlaubt, aber KEINE Klammern im Typ.
- Bereits getaggt (nicht erneut vorschlagen): ${existing}

ABSATZROLLEN (block): Bestimme für Absätze/Abschnitte mit klarer didaktischer Funktion eine Rolle.
- "quote" ist ein EXAKTES wörtliches Zitat aus dem ERSTEN Absatz des Abschnitts (z. B. sein erster Satz).
- Prüfe bei JEDER Rolle aktiv, ob auch die FOLGENDEN Absätze inhaltlich noch zum selben Abschnitt gehören —
  eine Einleitung oder Zusammenfassung ist oft 2–3 Absätze lang. Wenn ja, gib zusätzlich "endQuote":
  ein EXAKTES wörtliches Zitat aus dem LETZTEN zugehörigen Absatz. Bei einem einzelnen Absatz "endQuote" weglassen.
  Beispiel: {"quote": "Herzlich willkommen zur Einheit!", "endQuote": "Damit sind wir startklar.", "role": "einleitung"}
- "role" ist ein Slug aus: ${roles}
- Absätze, die bereits in einem :::-Block stecken, NICHT erneut vorschlagen.

Nur sichere Vorschläge. Lieber weniger und korrekt als viel und geraten.`,
    },
    { role: 'user', content: markdown },
  ]
}

/**
 * One-shot model call — deliberately NO automatic retry (unlike the repo
 * persistence path with its 30s retry): the run is user-triggered, the
 * failure is reported immediately via an ai-status broadcast, and the 🤖
 * button stays available — clicking again IS the retry, without the server
 * holding state or double-spending tokens on transient upstream errors.
 */
async function callModel(markdown, existingEntities) {
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // B-API accepts the key both ways — send both (see docs/skills)
      Authorization: `Bearer ${AI_API_KEY}`,
      'X-API-KEY': AI_API_KEY,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: buildPrompt(markdown, existingEntities),
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`Modell-Endpoint antwortete ${res.status}`)
  }
  const data = await res.json()
  let content = data?.choices?.[0]?.message?.content || ''
  // Some models wrap JSON in a fenced code block despite json_object mode
  content = content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  const parsed = JSON.parse(content)
  return {
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    roles: Array.isArray(parsed.roles) ? parsed.roles : [],
  }
}

// -------------------------------------------------------------- Entities ---
/**
 * Validate entity suggestions exactly like human input and push the valid
 * ones into the shared Y.Array. Returns the number added.
 * Anchoring runs against the PLAIN text (not the markdown source) — the model
 * quotes wording, not markdown syntax; bold marks and turndown escaping would
 * otherwise reject valid suggestions (audit KW-1).
 */
function validEntities(document, markdown, suggestions) {
  const plain = markdownToPlainText(markdown)
  const current = document.getArray('annotations').toArray()
  const resolved = resolveAnnotations(current, plain).filter((a) => a.start !== null)
  const added = []
  for (const s of suggestions) {
    const quote = typeof s?.quote === 'string' ? s.quote : ''
    const type = typeof s?.type === 'string' ? s.type.trim() : ''
    if (!isValidQuote(quote) || !isValidType(type)) continue
    const range = findQuoteRange(plain, quote)
    if (!range) continue // hallucinated
    const isDup = [...current, ...added].some((a) => a.quote === quote && a.type === type)
    if (isDup) continue
    const crosses = [...resolved, ...added.map((a) => ({ ...a, ...findQuoteRange(plain, a.quote) }))]
      .some((a) => a.start !== null && isCrossing(range, a))
    if (crosses) continue
    added.push({ id: randomUUID(), quote, occurrence: 1, type })
  }
  return added
}

function applyEntities(document, markdown, suggestions) {
  const added = validEntities(document, markdown, suggestions)
  if (added.length) document.getArray('annotations').push(added)
  return added.length
}

// ----------------------------------------------------------------- Roles ---
/** Plain text of a Yjs XML subtree (Y.XmlText via delta, elements recursively).
 * Children are joined with '\n' so text from adjacent blocks (e.g. two
 * paragraphs in a blockquote) never concatenates into matchable text — quotes
 * with '\n' are rejected (isValidQuote for entities, the applyRoles guard for
 * roles), so a quote can only match WITHIN one block. */
function ytextOf(node) {
  if (node instanceof Y.XmlText) {
    return node.toDelta().map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('')
  }
  if (node instanceof Y.XmlElement) {
    return node.toArray().map(ytextOf).join('\n')
  }
  return ''
}

// Unlike manual tagging (free roles allowed), AI-suggested roles must come
// from the catalog — the model is untrusted input and must not invent roles.
const KNOWN_ROLES = new Set(DEFAULT_BLOCK_ROLES.map((r) => r.slug))

/** Role suggestions that pass validation AND anchor to a not-yet-roled block
 * (dry counterpart of applyRoles, which re-validates at apply time). */
function validRoles(document, suggestions) {
  const frag = document.getXmlFragment('default')
  const out = []
  for (const s of suggestions) {
    const quote = typeof s?.quote === 'string' ? s.quote.trim() : ''
    const rawEnd = typeof s?.endQuote === 'string' ? s.endQuote.trim() : ''
    const slug = roleSlug(typeof s?.role === 'string' ? s.role : '')
    if (!quote || quote.includes('\n') || !KNOWN_ROLES.has(slug)) continue
    let found = false
    for (let i = 0; i < frag.length; i++) {
      const child = frag.get(i)
      if (!(child instanceof Y.XmlElement) || child.nodeName === 'roleBlock') continue
      if (ytextOf(child).includes(quote)) { found = true; break }
    }
    if (!found) continue
    out.push({ quote, endQuote: rawEnd.includes('\n') ? '' : rawEnd, role: slug })
  }
  return out
}

/**
 * Wrap the top-level blocks matched by the role suggestions in roleBlock
 * elements (same structure markdownToYdoc produces). Blocks already inside a
 * roleBlock, unknown quotes and non-catalog roles are skipped. Returns the
 * number wrapped.
 *
 * Concurrency note: Yjs has no "move" primitive — wrapping necessarily
 * REPLACES the block (clone → delete → insert), so remote keystrokes that
 * target exactly this block and are still in flight at the instant of the
 * replacement are lost (they integrate into the tombstoned node). This is
 * inherent to Yjs XML wrapping (client-side wraps share it) and the window is
 * a network round trip. Two mitigations: quotes are re-matched against the
 * CURRENT doc right before wrapping (stale suggestions from the model-latency
 * window are skipped, see test), and ALL wraps run in ONE transaction so
 * clients receive a single atomic update instead of N windows.
 */
function applyRoles(document, suggestions) {
  const frag = document.getXmlFragment('default')
  let wrapped = 0
  document.transact(() => {
    for (const s of suggestions) {
      const quote = typeof s?.quote === 'string' ? s.quote.trim() : ''
      const rawEnd = typeof s?.endQuote === 'string' ? s.endQuote.trim() : ''
      // Multi-line quotes would defeat the '\n'-join block separation in
      // ytextOf (same rule isValidQuote enforces for entities); a multi-line
      // endQuote just falls back to the single start block
      const endQuote = rawEnd.includes('\n') ? '' : rawEnd
      const slug = roleSlug(typeof s?.role === 'string' ? s.role : '')
      if (!quote || quote.includes('\n') || !KNOWN_ROLES.has(slug)) continue
      // Find the first not-yet-roled top-level block containing the quote.
      // (Already-wrapped blocks are roleBlock elements and skipped — this also
      // keeps a later suggestion from re-matching text wrapped moments ago.)
      let start = -1
      for (let i = 0; i < frag.length; i++) {
        const child = frag.get(i)
        if (!(child instanceof Y.XmlElement) || child.nodeName === 'roleBlock') continue
        if (ytextOf(child).includes(quote)) { start = i; break }
      }
      if (start < 0) continue // quote not found outside existing role blocks
      // Multi-paragraph sections: an optional endQuote (from the section's
      // LAST paragraph) extends the range forward — but never across an
      // existing role block, and an unknown endQuote falls back to the
      // single start block (endQuote is untrusted model output too).
      let end = start
      if (endQuote) {
        for (let i = start; i < frag.length; i++) {
          const child = frag.get(i)
          if (!(child instanceof Y.XmlElement) || child.nodeName === 'roleBlock') break
          if (ytextOf(child).includes(endQuote)) { end = i; break }
        }
      }
      const clones = []
      for (let i = start; i <= end; i++) clones.push(frag.get(i).clone())
      const roleEl = new Y.XmlElement('roleBlock')
      roleEl.setAttribute('role', slug)
      roleEl.insert(0, clones)
      frag.delete(start, end - start + 1)
      frag.insert(start, [roleEl])
      wrapped++
    }
  })
  return wrapped
}

// ------------------------------------------------------------------ Run ---
/**
 * Validated-but-not-yet-applied suggestions per document (review mode):
 * overwritten by every new run, consumed by ai-apply, cleared by ai-discard
 * and on document unload.
 */
const pending = new Map()

/** Drop pending suggestions on unload (collab.js afterUnloadDocument). */
export function clearPendingSuggestions(documentName) {
  pending.delete(documentName)
}

/**
 * Full tagging cycle: join as presence → ask the model → validate → report.
 * With a `connection` (review mode, the normal editor path) the validated
 * suggestions are sent back to the REQUESTING connection only and applied
 * later via applyPendingSuggestions; without one they are applied directly.
 * Never throws; errors are broadcast as {event:'ai-status', phase:'error'}.
 */
export async function runAiTagging({ document, documentName, markdown, connection = null }) {
  if (!aiConfigured()) {
    notify(document, { phase: 'error', code: 'not-configured' })
    return { entities: 0, roles: 0, error: 'not-configured' }
  }
  if (running.has(documentName)) {
    notify(document, { phase: 'error', code: 'busy' })
    return { entities: 0, roles: 0, error: 'busy' }
  }
  const readyAt = (lastRunAt.get(documentName) || 0) + AI_COOLDOWN_MS
  if (AI_COOLDOWN_MS > 0 && Date.now() < readyAt) {
    const retryInSec = Math.ceil((readyAt - Date.now()) / 1000)
    notify(document, { phase: 'error', code: 'cooldown', retryInSec })
    return { entities: 0, roles: 0, error: 'cooldown' }
  }
  running.add(documentName)
  notify(document, { phase: 'started' })
  // Join as a visible collaborative participant (works on hocuspocus docs;
  // plain Y.Docs in tests have no awareness — that's fine). NOTE: must be
  // setLocalState — hocuspocus initializes the server's local state to null,
  // and y-protocols' setLocalStateField is a silent NO-OP on a null state.
  try { document.awareness?.setLocalState({ user: AI_USER }) } catch { /* no awareness */ }
  try {
    const existing = document.getArray('annotations').toArray()
    const suggestions = await callModel(markdown, existing)
    if (connection) {
      const entities = validEntities(document, markdown, suggestions.entities)
        .map(({ quote, type }) => ({ quote, type }))
      const roles = validRoles(document, suggestions.roles)
      if (!entities.length && !roles.length) {
        notify(document, { phase: 'done', entities: 0, roles: 0 })
        return { entities: 0, roles: 0 }
      }
      pending.set(documentName, { entities, roles })
      try {
        connection.sendStateless(JSON.stringify({ event: 'ai-status', phase: 'review', entities, roles }))
      } catch { /* requester gone — suggestions stay pending for a re-request */ }
      notify(document, { phase: 'suggested', count: entities.length + roles.length })
      console.log(`[ai] ${documentName}: ${entities.length} entities + ${roles.length} roles suggested (review, model ${AI_MODEL})`)
      return { suggested: entities.length + roles.length }
    }
    const entities = applyEntities(document, markdown, suggestions.entities)
    const roles = applyRoles(document, suggestions.roles)
    console.log(`[ai] ${documentName}: ${entities} entities, ${roles} roles (model ${AI_MODEL})`)
    notify(document, { phase: 'done', entities, roles })
    return { entities, roles }
  } catch (err) {
    console.error(`[ai] ERROR ${documentName}: ${err.message}`)
    notify(document, { phase: 'error', code: 'upstream', detail: err.message })
    return { entities: 0, roles: 0, error: err.message }
  } finally {
    try { document.awareness?.setLocalState(null) } catch { /* no awareness */ }
    running.delete(documentName)
    rememberRun(documentName)
  }
}

/**
 * Apply the user-confirmed subset of the pending suggestions (review mode).
 * Both apply paths re-validate against the CURRENT document, so suggestions
 * gone stale between review and confirmation are skipped safely.
 */
export function applyPendingSuggestions(document, documentName, markdown, { keepEntities = [], keepRoles = [] } = {}) {
  const p = pending.get(documentName)
  if (!p) {
    notify(document, { phase: 'error', code: 'no-pending' })
    return { entities: 0, roles: 0, error: 'no-pending' }
  }
  pending.delete(documentName)
  const entities = applyEntities(document, markdown, keepEntities.map((i) => p.entities[i]).filter(Boolean))
  const roles = applyRoles(document, keepRoles.map((i) => p.roles[i]).filter(Boolean))
  console.log(`[ai] ${documentName}: applied ${entities} entities, ${roles} roles after review`)
  notify(document, { phase: 'done', entities, roles })
  return { entities, roles }
}

/** Discard the pending suggestions without applying anything. */
export function discardPendingSuggestions(document, documentName) {
  if (pending.delete(documentName)) notify(document, { phase: 'discarded' })
}
