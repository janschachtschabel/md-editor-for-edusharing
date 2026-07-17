// Round trip: Markdown → HTML → TipTap JSON → Y.Doc → TipTap JSON → HTML → Markdown.
// Verifies that every supported markdown construct survives the full pipeline
// used by the collab server (load/save) losslessly and stays stable.
import { TiptapTransformer } from '@hocuspocus/transformer'
import { generateHTML, generateJSON } from '@tiptap/html'
import { createExtensions } from '../src/extensions.js'
import { markdownToHtml, htmlToMarkdown } from '../src/markdown.js'

const extensions = createExtensions()

const md = `# Grundlagen der Kinematik

Die **Kinematik** mit ~~alt~~ und [Wikipedia](https://de.wikipedia.org/wiki/Kinematik).

Formeln: E = mc<sup>2</sup> und H<sub>2</sub>O.

| Größe | Symbol | Einheit |
| --- | --- | --- |
| Ort | r | Meter (m) |
| Geschwindigkeit | v | m/s |

- [ ] Einleitung schreiben
- [x] Tabelle prüfen

![Diagramm](https://example.org/bild.png)

- Ort
- Zeit

\`\`\`
v = ds/dt
\`\`\`
`

const html = markdownToHtml(md)
const json = generateJSON(html, extensions)
const ydoc = TiptapTransformer.toYdoc(json, 'default', extensions)
const json2 = TiptapTransformer.fromYdoc(ydoc, 'default')
const html2 = generateHTML(json2, extensions)
const md2 = htmlToMarkdown(html2)

console.log('=== Resulting markdown ===')
console.log(md2)
console.log('=== Checks ===')
const probes = [
  ['h1', '# Grundlagen der Kinematik'],
  ['bold', '**Kinematik**'],
  ['strike', '~~alt~~'],
  ['link', '[Wikipedia](https://de.wikipedia.org/wiki/Kinematik)'],
  ['sup', 'mc<sup>2</sup>'],
  ['sub', 'H<sub>2</sub>O'],
  ['table header', '| Größe | Symbol | Einheit |'],
  ['table row', '| Geschwindigkeit | v | m/s |'],
  ['task open', '- [ ] Einleitung schreiben'],
  ['task done', '- [x] Tabelle prüfen'],
  ['image', '![Diagramm](https://example.org/bild.png)'],
  ['code block', 'v = ds/dt'],
]
let fail = 0
for (const [name, probe] of probes) {
  const ok = md2.includes(probe)
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : JSON.stringify(probe))
}
// Stability: a second round must produce identical markdown
const md3 = htmlToMarkdown(generateHTML(generateJSON(markdownToHtml(md2), extensions), extensions))
console.log(md3 === md2 ? 'OK    round trip stable (md2 === md3)' : 'FAIL  round trip not stable')
if (md3 !== md2) fail++

// --- full CommonMark/GFM coverage: every standard construct must round-trip ------
// Pins the compat surface (format-support review 2026-07): each case runs the
// complete pipeline individually and must also be STABLE (2nd round identical).
const roundtripY = (m) => {
  const doc = TiptapTransformer.toYdoc(generateJSON(markdownToHtml(m), extensions), 'default', extensions)
  return htmlToMarkdown(generateHTML(TiptapTransformer.fromYdoc(doc, 'default'), extensions))
}
const standardCases = [
  ['emphasis (italic)', 'Ein *kursives* Wort.', /(\*|_)kursives\1/],
  ['inline code', 'Der Befehl `npm test` läuft.', /`npm test`/],
  ['fenced code with language', '```js\nconst x = 1\n```', /```js\r?\nconst x = 1/],
  ['blockquote', '> Ein Zitat.\n\nDanach.', /^> Ein Zitat\./m],
  ['nested blockquote', '> Außen\n> > Innen', /> +> Innen|> > Innen/],
  ['ordered list', '1. eins\n2. zwei', /^1\. +eins/m],
  ['ordered list with start≠1', '3. drei\n4. vier', /^3\. +drei/m],
  ['thematic break', 'Oben\n\n---\n\nUnten', /^(---|\*\*\*|\* \* \*|___)$/m],
  ['hard break', 'Zeile eins\\\nZeile zwei', /Zeile eins( {2}|\\)\r?\nZeile zwei/],
  ['headings h2–h6', '## Zwei\n\n###### Sechs', /^## Zwei$[\s\S]*^###### Sechs$/m],
  ['autolink (normalized to inline link)', 'Siehe <https://example.org/pfad>.', /https:\/\/example\.org\/pfad/],
  ['nested unordered list', '- a\n  - b1\n  - b2', /^[ \t]+- +b1/m],
  ['escaped markdown chars stay literal text', 'Kein \\*Fett\\* hier.', /\\\*Fett\\\*|\*Fett\*/],
  ['link with title', '[x](https://e.org "Titel")', /\(https:\/\/e\.org "Titel"\)/],
  ['image with alt + title', '![Alt](https://e.org/b.png "T")', /!\[Alt\]\(https:\/\/e\.org\/b\.png "T"\)/],
  // Sized images persist as raw HTML (CommonMark allows it; GitHub renders
  // width attributes) — unsized images stay pure markdown (case above)
  ['sized image keeps its width attribute as inline HTML',
    'Bild: <img src="https://e.org/b.png" alt="A" width="420">',
    /<img src="https:\/\/e\.org\/b\.png" alt="A" width="420">/],
  ['sized image with width AND height keeps both (lossless)',
    '<img src="https://e.org/c.png" alt="B" width="300" height="200">',
    /<img src="https:\/\/e\.org\/c\.png" alt="B" width="300" height="200">/],
]
for (const [name, input, expect] of standardCases) {
  const out = roundtripY(input)
  const stable = roundtripY(out) === out
  const ok = expect.test(out) && stable
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', `standard: ${name}`, ok ? '' : `→ ${JSON.stringify(out)}${stable ? '' : ' [UNSTABLE]'}`)
}

// --- paragraph roles (::: container) round trip --------------------------------
// Roles are STRUCTURE and live in the markdown; inner markdown (bold, lists,
// multiple paragraphs) must survive, and the ::: fences must round-trip.
const roleMd = `::: definition
Die **Kartoffel** ist eine Nutzpflanze.

- Knolle
- Blüte
:::`
const roundtrip = (m) => htmlToMarkdown(generateHTML(generateJSON(markdownToHtml(m), extensions), extensions))
const roleOut = roundtrip(roleMd)
const roleStable = roundtrip(roleOut)
console.log('--- role block markdown ---')
console.log(roleOut)
const roleProbes = [
  ['role open fence', '::: definition'],
  ['role close fence', ':::'],
  ['inner bold survives', '**Kartoffel**'],
  ['inner list survives', 'Knolle'],
  ['inner list stays a list item', /^- +Knolle$/m.test(roleOut)],
]
for (const [name, probe] of roleProbes) {
  const ok = typeof probe === 'boolean' ? probe : roleOut.includes(probe)
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : JSON.stringify(probe))
}
const roleStableOk = roleStable === roleOut
console.log(roleStableOk ? 'OK    role round trip stable' : 'FAIL  role round trip not stable')
if (!roleStableOk) fail++

// --- NESTED role blocks (sub-marking inside a tagged paragraph) -----------------
const nestedMd = `::: these
Satz eins.

::: definition
Satz zwei.
:::

Satz drei.
:::`
const nestedOut = roundtrip(nestedMd)
const nestedStable = roundtrip(nestedOut)
console.log('--- nested role block markdown ---')
console.log(nestedOut)
// Structural check: the parsed doc must have a roleBlock(definition) NESTED
// inside a roleBlock(these) — not a mangled/collapsed inner fence.
const nestedJson = generateJSON(markdownToHtml(nestedOut), extensions)
function findNested(node, outer = null) {
  const role = node.type === 'roleBlock' ? node.attrs?.role : null
  if (role && outer) return { outer, inner: role }
  for (const c of node.content || []) {
    const hit = findNested(c, role || outer)
    if (hit) return hit
  }
  return null
}
const nesting = findNested(nestedJson)
const nestedProbes = [
  ['inner Definition is NESTED inside outer These', nesting && nesting.outer === 'these' && nesting.inner === 'definition'],
  ['inner fence stays on its own line (not collapsed)', /::: definition\r?\nSatz zwei\./.test(nestedOut)],
  ['nested round trip stable', nestedStable === nestedOut],
]
for (const [name, ok] of nestedProbes) {
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name)
}

process.exit(fail ? 1 : 0)
