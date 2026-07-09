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
    { quote: 'Anna Mueller erforscht', role: 'Böse Rolle!!' },            // invalid slug → normalized or skipped
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

const result = await runAiTagging({
  document: ydoc,
  documentName: 'test-doc',
  markdown: MD,
})

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
check('unknown-quote role skipped (only one fence pair)',
  (mdAfter.match(/^::: [a-z]/gm) || []).length === 1, mdAfter)

// --- result + status broadcasts --------------------------------------------------
check('result reports counts', result.entities === 2 && result.roles === 1, result)
check('model was called exactly once', modelCalls === 1)
check('request went to the configured b-api with model + key',
  globalThis.__lastModelRequest.url.includes('/chat/completions')
  && Boolean(globalThis.__lastModelRequest.model) && globalThis.__lastModelRequest.hasKey,
  globalThis.__lastModelRequest)
check('status broadcasts: started then done with counts',
  broadcasts.some((b) => b.event === 'ai-status' && b.phase === 'started')
  && broadcasts.some((b) => b.event === 'ai-status' && b.phase === 'done' && b.entities === 2 && b.roles === 1),
  broadcasts)

// --- second run: everything is a duplicate now → no new tags ---------------------
const result2 = await runAiTagging({ document: ydoc, documentName: 'test-doc', markdown: mdAfter })
check('re-run adds nothing (duplicates + already-roled block skipped)',
  result2.entities === 0 && result2.roles === 0
  && ydoc.getArray('annotations').length === 2, result2)

process.exit(fail ? 1 : 0)
