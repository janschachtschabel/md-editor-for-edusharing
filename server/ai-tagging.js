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
import { AI_API_KEY, AI_BASE_URL, AI_MODEL, AI_TIMEOUT_MS } from './config.js'
import {
  findQuoteRange, isCrossing, isValidQuote, isValidType, resolveAnnotations,
} from '../src/annotations.js'
import { DEFAULT_BLOCK_ROLES, DEFAULT_TYPE_GROUPS, roleSlug } from '../src/entity-types.js'

/** True when an API key is available (feature is otherwise hidden/disabled). */
export function aiConfigured() {
  return Boolean(AI_API_KEY)
}

/** Presence identity the AI uses while it works in the document. */
const AI_USER = { name: '🤖 KI-Tagger', color: '#7b1fa2' }

/** One tagging run per document at a time. */
const running = new Set()

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
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt: {"entities": [{"quote","type"}], "roles": [{"quote","role"}]}.

ENTITÄTEN (inline): Erkenne bedeutungstragende Entitäten im Fließtext.
- "quote" ist ein EXAKTES, wörtliches Zitat aus dem Text (max. 200 Zeichen, kein Zeilenumbruch, keine Markdown-Syntax).
- "type" bevorzugt aus diesem Katalog: ${types}. Freie Typen erlaubt, aber KEINE Klammern im Typ.
- Bereits getaggt (nicht erneut vorschlagen): ${existing}

ABSATZROLLEN (block): Bestimme für Absätze mit klarer didaktischer Funktion eine Rolle.
- "quote" ist ein EXAKTES wörtliches Zitat aus dem betreffenden Absatz (z. B. sein erster Satz).
- "role" ist ein Slug aus: ${roles}
- Absätze, die bereits in einem :::-Block stecken, NICHT erneut vorschlagen.

Nur sichere Vorschläge. Lieber weniger und korrekt als viel und geraten.`,
    },
    { role: 'user', content: markdown },
  ]
}

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
 */
function applyEntities(document, markdown, suggestions) {
  const arr = document.getArray('annotations')
  const current = arr.toArray()
  const resolved = resolveAnnotations(current, markdown).filter((a) => a.start !== null)
  const added = []
  for (const s of suggestions) {
    const quote = typeof s?.quote === 'string' ? s.quote : ''
    const type = typeof s?.type === 'string' ? s.type.trim() : ''
    if (!isValidQuote(quote) || !isValidType(type)) continue
    const range = findQuoteRange(markdown, quote)
    if (!range) continue // hallucinated
    const isDup = [...current, ...added].some((a) => a.quote === quote && a.type === type)
    if (isDup) continue
    const crosses = [...resolved, ...added.map((a) => ({ ...a, ...findQuoteRange(markdown, a.quote) }))]
      .some((a) => a.start !== null && isCrossing(range, a))
    if (crosses) continue
    added.push({ id: randomUUID(), quote, occurrence: 1, type })
  }
  if (added.length) arr.push(added)
  return added.length
}

// ----------------------------------------------------------------- Roles ---
/** Plain text of a Yjs XML subtree (Y.XmlText via delta, elements recursively). */
function ytextOf(node) {
  if (node instanceof Y.XmlText) {
    return node.toDelta().map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('')
  }
  if (node instanceof Y.XmlElement) {
    return node.toArray().map(ytextOf).join('')
  }
  return ''
}

// Unlike manual tagging (free roles allowed), AI-suggested roles must come
// from the catalog — the model is untrusted input and must not invent roles.
const KNOWN_ROLES = new Set(DEFAULT_BLOCK_ROLES.map((r) => r.slug))

/**
 * Wrap the top-level blocks matched by the role suggestions in roleBlock
 * elements (same structure markdownToYdoc produces). Blocks already inside a
 * roleBlock, unknown quotes and non-catalog roles are skipped. Returns the
 * number wrapped.
 */
function applyRoles(document, suggestions) {
  const frag = document.getXmlFragment('default')
  let wrapped = 0
  const usedIndices = new Set()
  for (const s of suggestions) {
    const quote = typeof s?.quote === 'string' ? s.quote.trim() : ''
    const slug = roleSlug(typeof s?.role === 'string' ? s.role : '')
    if (!quote || !KNOWN_ROLES.has(slug)) continue
    // Find the first not-yet-roled top-level block containing the quote
    let index = -1
    for (let i = 0; i < frag.length; i++) {
      if (usedIndices.has(i)) continue
      const child = frag.get(i)
      if (!(child instanceof Y.XmlElement) || child.nodeName === 'roleBlock') continue
      if (ytextOf(child).includes(quote)) { index = i; break }
    }
    if (index < 0) continue // quote not found outside existing role blocks
    document.transact(() => {
      const child = frag.get(index)
      const clone = child.clone()
      const roleEl = new Y.XmlElement('roleBlock')
      roleEl.setAttribute('role', slug)
      roleEl.insert(0, [clone])
      frag.delete(index, 1)
      frag.insert(index, [roleEl])
    })
    usedIndices.add(index)
    wrapped++
  }
  return wrapped
}

// ------------------------------------------------------------------ Run ---
/**
 * Full tagging cycle: join as presence → ask the model → validate & apply →
 * report via stateless broadcast → leave. Never throws; errors are broadcast
 * as {event:'ai-status', phase:'error', code} and returned.
 */
export async function runAiTagging({ document, documentName, markdown }) {
  if (!aiConfigured()) {
    notify(document, { phase: 'error', code: 'not-configured' })
    return { entities: 0, roles: 0, error: 'not-configured' }
  }
  if (running.has(documentName)) {
    notify(document, { phase: 'error', code: 'busy' })
    return { entities: 0, roles: 0, error: 'busy' }
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
  }
}
