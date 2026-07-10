// Unit/integration tests for the AI auto-tagging module (server/ai-tagging.js):
// drives runAiTagging against a real Y.Doc (built via the same pipeline the
// collab server uses) with a STUBBED model endpoint, and asserts that
//   - valid entity suggestions land in the shared Y.Array (pills)
//   - hallucinated quotes, crossing spans and duplicates are skipped
//   - valid role suggestions wrap the matching paragraph (::: markup)
//   - unknown-quote roles and already-roled blocks are skipped
//   - status broadcasts fire (started → done with counts)
// Configure BEFORE the module (and its config.js) is imported below
process.env.AI_API_KEY = 'test-key'
process.env.AI_MODEL = 'gpt-5.4-mini'
process.env.AI_COOLDOWN_MS = '60000' // cooldown behavior is asserted explicitly below

import { TiptapTransformer } from '@hocuspocus/transformer'
import { generateHTML, generateJSON } from '@tiptap/html'
import { createExtensions } from '../src/extensions.js'
import { markdownToHtml, htmlToMarkdown } from '../src/markdown.js'

let fail = 0
function check(name, ok, extra = '') {
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : `→ ${JSON.stringify(extra)}`)
}

const extensions = createExtensions()
const MD = `Die Kartoffel ist eine Nutzpflanze. Sie stammt aus Suedamerika.

Anna Mueller erforscht die Kartoffel in Weimar.`

// --- stub the model endpoint ---------------------------------------------------
const modelResponse = {
  entities: [
    { quote: 'Kartoffel', type: 'Thema' },            // valid
    { quote: 'Anna Mueller', type: 'Person' },        // valid
    { quote: 'Erfurt', type: 'Ort' },                 // hallucinated → skip
    { quote: 'Kartoffel', type: 'Thema' },            // duplicate → skip
    { quote: 'Weimar (Ort)', type: 'Ort (Stadt)' },   // invalid type (parens) → skip
  ],
  roles: [
    { quote: 'Die Kartoffel ist eine Nutzpflanze.', role: 'definition' }, // valid
    { quote: 'Gibt es nicht im Text.', role: 'aufgabe' },                 // unknown quote → skip
    { quote: 'Anna Mueller erforscht', role: 'Böse Rolle!!' },            // invalid slug → skipped
    { quote: 'Anna Mueller erforscht', role: 'beispiel' },                // valid (2nd paragraph)
  ],
}
let modelCalls = 0
globalThis.fetch = async (url, opts) => {
  modelCalls++
  const body = JSON.parse(opts.body)
  globalThis.__lastModelRequest = { url: String(url), model: body.model, hasKey: Boolean(opts.headers['X-API-KEY']) }
  return {
    ok: true, status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ choices: [{ message: { content: JSON.stringify(modelResponse) } }] }),
  }
}

const { runAiTagging } = await import('../server/ai-tagging.js')

// --- build a live doc the way the server does ----------------------------------
const ydoc = TiptapTransformer.toYdoc(generateJSON(markdownToHtml(MD), extensions), 'default', extensions)
const broadcasts = []
ydoc.broadcastStateless = (s) => broadcasts.push(JSON.parse(s)) // capture status events

// Count Yjs updates during the run: all role wraps must land in ONE
// transaction (one update) so concurrent clients see one atomic change —
// plus one update for the entity push ⇒ at most 2 in total.
let updates = 0
const countUpdates = () => updates++
ydoc.on('update', countUpdates)

const result = await runAiTagging({
  document: ydoc,
  documentName: 'test-doc',
  markdown: MD,
})
ydoc.off('update', countUpdates)

// --- entities -------------------------------------------------------------------
const anns = ydoc.getArray('annotations').toArray()
check('two valid entities were added', anns.length === 2, anns)
check('valid entity: Kartoffel (Thema)', anns.some((a) => a.quote === 'Kartoffel' && a.type === 'Thema'))
check('valid entity: Anna Mueller (Person)', anns.some((a) => a.quote === 'Anna Mueller' && a.type === 'Person'))
check('hallucinated quote skipped', !anns.some((a) => a.quote === 'Erfurt'))
check('every added annotation has an id + occurrence', anns.every((a) => a.id && a.occurrence >= 1))

// --- roles ----------------------------------------------------------------------
const mdAfter = htmlToMarkdown(generateHTML(TiptapTransformer.fromYdoc(ydoc, 'default'), extensions))
check('valid role wraps the matching paragraph', /^::: definition$/m.test(mdAfter), mdAfter)
check('wrapped paragraph keeps its text inside the fence',
  /::: definition\r?\nDie Kartoffel ist eine Nutzpflanze\. Sie stammt aus Suedamerika\.\r?\n:::/.test(mdAfter), mdAfter)
check('second valid role wraps the second paragraph', /^::: beispiel$/m.test(mdAfter), mdAfter)
check('unknown-quote + invalid-slug roles skipped (exactly two fences)',
  (mdAfter.match(/^::: [a-z]/gm) || []).length === 2, mdAfter)
check('all role wraps batched into ONE transaction (≤2 updates incl. entity push)',
  updates <= 2, `updates=${updates}`)

// --- result + status broadcasts --------------------------------------------------
check('result reports counts', result.entities === 2 && result.roles === 2, result)
check('model was called exactly once', modelCalls === 1)
check('request went to the configured b-api with model + key',
  globalThis.__lastModelRequest.url.includes('/chat/completions')
  && Boolean(globalThis.__lastModelRequest.model) && globalThis.__lastModelRequest.hasKey,
  globalThis.__lastModelRequest)
check('status broadcasts: started then done with counts',
  broadcasts.some((b) => b.event === 'ai-status' && b.phase === 'started')
  && broadcasts.some((b) => b.event === 'ai-status' && b.phase === 'done' && b.entities === 2 && b.roles === 2),
  broadcasts)

// --- second run: everything is a duplicate now → no new tags ---------------------
// (own documentName: the per-document cooldown would otherwise reject the re-run)
const result2 = await runAiTagging({ document: ydoc, documentName: 'test-doc-rerun', markdown: mdAfter })
check('re-run adds nothing (duplicates + already-roled block skipped)',
  result2.entities === 0 && result2.roles === 0
  && ydoc.getArray('annotations').length === 2, result2)

// --- cooldown: a completed run blocks the next one on the SAME document ----------
// (audit P-1: without it any write-capable user can drive model costs freely)
{
  const coolDoc = TiptapTransformer.toYdoc(generateJSON(markdownToHtml(MD), extensions), 'default', extensions)
  const coolBroadcasts = []
  coolDoc.broadcastStateless = (s) => coolBroadcasts.push(JSON.parse(s))
  const first = await runAiTagging({ document: coolDoc, documentName: 'cool-doc', markdown: MD })
  check('cooldown: first run completes normally', first.entities === 2 && !first.error, first)
  const callsBeforeCooldown = modelCalls
  const second = await runAiTagging({ document: coolDoc, documentName: 'cool-doc', markdown: MD })
  check('cooldown: immediate second run is rejected without a model call',
    second.error === 'cooldown' && modelCalls === callsBeforeCooldown, second)
  check('cooldown: clients are told the wait in seconds',
    coolBroadcasts.some((b) => b.code === 'cooldown' && b.retryInSec > 0 && b.retryInSec <= 60),
    coolBroadcasts)
  check('cooldown: a DIFFERENT document is not affected',
    !(await runAiTagging({ document: coolDoc, documentName: 'other-cool-doc', markdown: MD })).error)
}

// --- authorization gate (the REAL collab.js onStateless hook) --------------------
// Read-only connections must not be able to use the AI as a write proxy —
// the security check lives in server/collab.js, so drive that hook directly.
{
  const { hocuspocus } = await import('../server/collab.js')
  const onStateless = hocuspocus.configuration.onStateless
  const gateDoc = TiptapTransformer.toYdoc(generateJSON(markdownToHtml(MD), extensions), 'default', extensions)
  const gateBroadcasts = []
  gateDoc.broadcastStateless = (s) => gateBroadcasts.push(JSON.parse(s))

  const callsBefore = modelCalls
  await onStateless({
    payload: JSON.stringify({ event: 'ai-tag' }),
    document: gateDoc, documentName: 'gate-doc',
    connection: { readOnly: true },
  })
  check('read-only connection: model NOT called', modelCalls === callsBefore)
  check('read-only connection: no-write error broadcast',
    gateBroadcasts.some((b) => b.event === 'ai-status' && b.code === 'no-write'), gateBroadcasts)
  check('read-only connection: document unchanged',
    gateDoc.getArray('annotations').length === 0)

  await onStateless({
    payload: JSON.stringify({ event: 'ai-tag' }),
    document: gateDoc, documentName: 'gate-doc',
    connection: { readOnly: false },
  })
  check('writable connection: model called + tags applied',
    modelCalls === callsBefore + 1 && gateDoc.getArray('annotations').length === 2)
}

// --- busy lock: only one run per document at a time -------------------------------
{
  let release
  const gate = new Promise((r) => { release = r })
  const plainFetch = globalThis.fetch
  globalThis.fetch = async (...args) => { await gate; return plainFetch(...args) }

  const busyDoc = TiptapTransformer.toYdoc(generateJSON(markdownToHtml(MD), extensions), 'default', extensions)
  const busyBroadcasts = []
  busyDoc.broadcastStateless = (s) => busyBroadcasts.push(JSON.parse(s))

  const first = runAiTagging({ document: busyDoc, documentName: 'busy-doc', markdown: MD })
  await new Promise((r) => setTimeout(r, 10)) // let run 1 acquire the lock
  const second = await runAiTagging({ document: busyDoc, documentName: 'busy-doc', markdown: MD })
  check('second concurrent run is rejected as busy',
    second.error === 'busy' && busyBroadcasts.some((b) => b.code === 'busy'), second)
  release()
  const firstResult = await first
  check('first run completes normally after the busy rejection',
    firstResult.entities === 2 && firstResult.roles === 2, firstResult)
  globalThis.fetch = plainFetch
}

// --- stale suggestions: document changed WHILE the model was thinking --------------
// The markdown snapshot goes to the model at T0; users keep editing. Role
// quotes are re-matched against the CURRENT doc at apply time — a vanished
// paragraph must be skipped gracefully, never crash or wrap the wrong block.
{
  let release
  const gate = new Promise((r) => { release = r })
  const plainFetch = globalThis.fetch
  globalThis.fetch = async (...args) => { await gate; return plainFetch(...args) }

  const staleDoc = TiptapTransformer.toYdoc(generateJSON(markdownToHtml(MD), extensions), 'default', extensions)
  staleDoc.broadcastStateless = () => {}
  const run = runAiTagging({ document: staleDoc, documentName: 'stale-doc', markdown: MD })
  await new Promise((r) => setTimeout(r, 10))
  // Concurrent edit while the model "thinks": remove ALL content
  const frag = staleDoc.getXmlFragment('default')
  staleDoc.transact(() => frag.delete(0, frag.length))
  release()
  const staleResult = await run
  check('stale role suggestions are skipped (no matching block left)',
    staleResult.roles === 0 && !staleResult.error, staleResult)
  check('stale run does not corrupt the emptied document',
    staleDoc.getXmlFragment('default').length === 0)
}

// --- multi-paragraph roles: quote (first block) + endQuote (last block) -----------
// An Einleitung can span several paragraphs — the model marks the range via an
// exact quote from the FIRST and an optional exact quote from the LAST block.
{
  const SPAN_MD = `Erster Satz der Einleitung.

Zweiter Absatz der Einleitung.

Hier beginnt der Hauptteil.`
  const plainFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      entities: [],
      roles: [
        // spans paragraphs 1–2, paragraph 3 stays outside
        { quote: 'Erster Satz der Einleitung.', endQuote: 'Zweiter Absatz der Einleitung.', role: 'einleitung' },
        // endQuote unknown → must fall back to wrapping only the start block
        { quote: 'Hier beginnt der Hauptteil.', endQuote: 'Gibt es nicht.', role: 'kernidee' },
      ],
    }) } }] }),
  })

  const spanDoc = TiptapTransformer.toYdoc(generateJSON(markdownToHtml(SPAN_MD), extensions), 'default', extensions)
  spanDoc.broadcastStateless = () => {}
  const spanResult = await runAiTagging({ document: spanDoc, documentName: 'span-doc', markdown: SPAN_MD })
  const spanMd = htmlToMarkdown(generateHTML(TiptapTransformer.fromYdoc(spanDoc, 'default'), extensions))

  check('multi-paragraph role wraps BOTH intro paragraphs in one fence',
    /::: einleitung\r?\nErster Satz der Einleitung\.\r?\n\r?\nZweiter Absatz der Einleitung\.\r?\n:::/.test(spanMd), spanMd)
  check('paragraph after the range stays OUTSIDE the intro fence',
    !/::: einleitung[\s\S]*Hauptteil[\s\S]*?\n:::\s*$/.test(spanMd.split('::: kernidee')[0] + ':::'), spanMd)
  check('unknown endQuote falls back to single-block wrap',
    /::: kernidee\r?\nHier beginnt der Hauptteil\.\r?\n:::/.test(spanMd), spanMd)
  check('span run reports two roles', spanResult.roles === 2, spanResult)
  globalThis.fetch = plainFetch
}

// --- nested blocks: quote crossing a paragraph boundary must NOT match -------------
// ytextOf must separate block children (audit 6, L-1): a blockquote with two
// paragraphs ("Ende eins." / "Zwei Anfang.") must not expose the concatenation
// artifact "eins.Zwei" as matchable text — otherwise a garbled model quote
// wraps the wrong block. A quote WITHIN one paragraph still has to match.
{
  const BQ_MD = `> Ende eins.
>
> Zwei Anfang.

Normaler Absatz.`
  const plainFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      entities: [],
      roles: [
        // crosses the paragraph boundary inside the blockquote → must be skipped
        { quote: 'eins.Zwei', role: 'einleitung' },
        // lies within ONE paragraph of the blockquote → must still wrap it
        { quote: 'Zwei Anfang.', role: 'merksatz' },
      ],
    }) } }] }),
  })
  const bqDoc = TiptapTransformer.toYdoc(generateJSON(markdownToHtml(BQ_MD), extensions), 'default', extensions)
  bqDoc.broadcastStateless = () => {}
  const bqResult = await runAiTagging({ document: bqDoc, documentName: 'bq-doc', markdown: BQ_MD })
  const bqMd = htmlToMarkdown(generateHTML(TiptapTransformer.fromYdoc(bqDoc, 'default'), extensions))
  check('cross-paragraph-boundary quote does NOT match (no einleitung fence)',
    !/::: einleitung/.test(bqMd), bqMd)
  check('within-paragraph quote in a nested block still wraps the blockquote',
    bqResult.roles === 1 && /::: merksatz/.test(bqMd), bqMd)
  globalThis.fetch = plainFetch
}

// --- role quotes containing '\n' are rejected (audit 7, N-1) ----------------------
// The '\n'-join in ytextOf only guarantees "a quote matches WITHIN one block"
// if multi-line quotes never reach the matcher — enforce it like isValidQuote
// does for entities. A multi-line endQuote falls back to the single start block.
{
  const NL_MD = `> Ende eins.
>
> Zwei Anfang.

Normaler Absatz.`
  const plainFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      entities: [],
      roles: [
        // multi-line quote (matches the joined blockquote text) → must be rejected
        { quote: 'Ende eins.\nZwei Anfang.', role: 'einleitung' },
        // multi-line endQuote → fall back to wrapping only the start block
        { quote: 'Normaler Absatz.', endQuote: 'Egal\nwas.', role: 'merksatz' },
      ],
    }) } }] }),
  })
  const nlDoc = TiptapTransformer.toYdoc(generateJSON(markdownToHtml(NL_MD), extensions), 'default', extensions)
  nlDoc.broadcastStateless = () => {}
  const nlResult = await runAiTagging({ document: nlDoc, documentName: 'nl-doc', markdown: NL_MD })
  const nlMd = htmlToMarkdown(generateHTML(TiptapTransformer.fromYdoc(nlDoc, 'default'), extensions))
  check('multi-line role quote is rejected (no einleitung fence)',
    !/::: einleitung/.test(nlMd), nlMd)
  check('multi-line endQuote falls back to single-block wrap',
    nlResult.roles === 1 && /::: merksatz\r?\nNormaler Absatz\.\r?\n:::/.test(nlMd), nlMd)
  globalThis.fetch = plainFetch
}

// --- multi-paragraph range must not swallow an existing role block ----------------
{
  const plainFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      entities: [],
      // range would span across the pre-existing merksatz block → must stop before it
      roles: [{ quote: 'Absatz eins.', endQuote: 'Absatz drei.', role: 'einleitung' }],
    }) } }] }),
  })
  const HTML = '<p>Absatz eins.</p><section data-role="merksatz"><p>Wichtig!</p></section><p>Absatz drei.</p>'
  const guardDoc = TiptapTransformer.toYdoc(generateJSON(HTML, extensions), 'default', extensions)
  guardDoc.broadcastStateless = () => {}
  await runAiTagging({ document: guardDoc, documentName: 'guard-doc', markdown: 'Absatz eins.\n\nWichtig!\n\nAbsatz drei.' })
  const guardMd = htmlToMarkdown(generateHTML(TiptapTransformer.fromYdoc(guardDoc, 'default'), extensions))
  check('range stops before an existing role block (merksatz not swallowed)',
    /::: einleitung\r?\nAbsatz eins\.\r?\n:::/.test(guardMd)
    && /::: merksatz\r?\nWichtig!\r?\n:::/.test(guardMd), guardMd)
  globalThis.fetch = plainFetch
}

process.exit(fail ? 1 : 0)
