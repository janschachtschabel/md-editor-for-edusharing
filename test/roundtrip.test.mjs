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
process.exit(fail ? 1 : 0)
