/**
 * Toolbar assembly for <md-collab-editor> (extracted from the component,
 * audit M-3): format buttons from the static TOOLBAR definition plus the
 * feature buttons (entity tagging, role select, TOC, glossary, find,
 * comments, AI) and the right-hand cluster (word count, presence chips, save
 * bar), incl. the WAI-ARIA roving-tabindex pattern. Pure DOM wiring — every
 * feature lives in its controller; `c` is the component instance that owns
 * the referenced controllers, buttons and state.
 */
import { TOOLBAR } from './toolbar.js'
import { upsertToc } from './toc.js'
import { upsertGlossary } from './glossary.js'
import { downloadMarkdown, markdownFilename, openPrintView } from './export.js'
import { t } from './i18n.js'

export function buildToolbar(c) {
  const bar = c.querySelector('.mce-toolbar')
  c._buttons = []
  for (const tool of TOOLBAR) {
    if (tool.sep) {
      const sep = document.createElement('span')
      sep.className = 'mce-sep'
      bar.appendChild(sep)
      continue
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.innerHTML = tool.labelKey ? t(c._lang, tool.labelKey) : tool.label
    const title = t(c._lang, tool.titleKey)
    btn.title = title
    btn.setAttribute('aria-label', title)
    if (tool.active) btn.setAttribute('aria-pressed', 'false')
    btn.dataset.cmd = tool.cmd
    if (tool.table) btn.dataset.table = 'true'
    btn.addEventListener('click', () => {
      // 🖼 is the SINGLE image entry point — fallback cascade:
      // mediaApi → media panel (upload ⬆ / URL 🔗 / manage) ·
      // uploadImage only → file picker · neither → URL prompt (tool.run)
      if (tool.cmd === 'image') {
        if (c._mediaApi) return c._media.toggle()
        if (c.uploadImage) return c._pickImage()
      }
      tool.run(c.editor)
    })
    bar.appendChild(btn)
    c._buttons.push({ btn, tool })
  }

  const addSep = () => {
    const s = document.createElement('span')
    s.className = 'mce-sep'
    bar.appendChild(s)
  }

  // ── Tagging cluster: entity tag, paragraph role, AI suggestions ─────────
  // Semantic tagging needs component context (popup, Y.Array) — the button
  // therefore lives here instead of in the static TOOLBAR definition
  addSep()
  c._tagBtn = document.createElement('button')
  c._tagBtn.type = 'button'
  c._tagBtn.innerHTML = t(c._lang, 'editor.tagButtonLabel')
  c._tagBtn.title = t(c._lang, 'editor.tagButtonTitle')
  c._tagBtn.setAttribute('aria-label', t(c._lang, 'editor.tagButtonTitle'))
  c._tagBtn.disabled = true
  c._tagBtn.addEventListener('click', () => c._tags.openTagDialog())
  bar.appendChild(c._tagBtn)

  // Paragraph-role control (the SECOND tagging system, src/role-ui.js):
  // a single exclusive choice per block → a <select>, distinct from the
  // multi-toggle entity tagging. Roles are structure, never keywords.
  bar.appendChild(c._roles.buildSelect())

  // AI auto-tagging trigger — the actual AI lives entirely on the server
  // (server/ai-tagging.js); the button just sends the command and mirrors
  // the broadcast status. Hidden until the server reports aiAvailable.
  c._aiBtn = document.createElement('button')
  c._aiBtn.type = 'button'
  c._aiBtn.className = 'mce-ai-btn'
  c._aiBtn.innerHTML = t(c._lang, 'ai.buttonLabel')
  c._aiBtn.title = t(c._lang, 'ai.buttonTitle')
  c._aiBtn.setAttribute('aria-label', t(c._lang, 'ai.buttonTitle'))
  c._aiBtn.style.display = 'none'
  c._aiBtn.addEventListener('click', () => {
    c.provider.sendStateless(JSON.stringify({ event: 'ai-tag' }))
  })
  bar.appendChild(c._aiBtn)
  c._aiStatusEl = document.createElement('span')
  c._aiStatusEl.className = 'mce-ai-status'
  c._aiStatusEl.setAttribute('role', 'status')
  c._aiStatusEl.setAttribute('aria-live', 'polite')
  bar.appendChild(c._aiStatusEl)

  // ── Document tools: find/replace, TOC, glossary ─────────────────────────
  addSep()
  // Find & replace toggle (src/find-replace.js)
  bar.appendChild(c._find.buildButton())

  // In-content table of contents (src/toc.js): inserts/updates a linked
  // ::: inhaltsverzeichnis block at the top of the document
  c._tocBtn = document.createElement('button')
  c._tocBtn.type = 'button'
  c._tocBtn.className = 'mce-toc-btn'
  c._tocBtn.innerHTML = '☰'
  c._tocBtn.title = t(c._lang, 'toolbar.toc')
  c._tocBtn.setAttribute('aria-label', t(c._lang, 'toolbar.toc'))
  c._tocBtn.disabled = true
  c._tocBtn.addEventListener('click', () => {
    upsertToc(c.editor, c._lang)
  })
  bar.appendChild(c._tocBtn)

  // Entity glossary: appends/updates a ::: glossar block (src/glossary.js)
  c._glossaryBtn = document.createElement('button')
  c._glossaryBtn.type = 'button'
  c._glossaryBtn.className = 'mce-glossary-btn'
  c._glossaryBtn.innerHTML = t(c._lang, 'glossary.button')
  c._glossaryBtn.title = t(c._lang, 'glossary.buttonTitle')
  c._glossaryBtn.setAttribute('aria-label', t(c._lang, 'glossary.buttonTitle'))
  c._glossaryBtn.disabled = true
  c._glossaryBtn.addEventListener('click', () => {
    upsertGlossary(c.editor, c._tags.resolvedList(), c._lang)
  })
  bar.appendChild(c._glossaryBtn)

  // ── Panel: node comments (media lives behind the 🖼 button) ──────────────
  // Hidden until the host injects the API (which may have happened BEFORE
  // the mount → derive the state here)
  addSep()
  bar.appendChild(c._comments.buildButton())
  c._comments.button.style.display = c._commentsApi ? '' : 'none'

  // ── Export cluster (src/export.js): markdown download + print view ───────
  // Read actions, deliberately usable in read-only mode too
  addSep()
  const mdBtn = document.createElement('button')
  mdBtn.type = 'button'
  mdBtn.className = 'mce-export-md-btn'
  mdBtn.innerHTML = '⬇ MD'
  mdBtn.title = t(c._lang, 'toolbar.exportMd')
  mdBtn.setAttribute('aria-label', t(c._lang, 'toolbar.exportMd'))
  mdBtn.addEventListener('click', () => {
    downloadMarkdown(c.getMarkdown(), markdownFilename(c.getAttribute('document-name')))
  })
  bar.appendChild(mdBtn)
  const printBtn = document.createElement('button')
  printBtn.type = 'button'
  printBtn.className = 'mce-print-btn'
  printBtn.innerHTML = '🖨'
  printBtn.title = t(c._lang, 'toolbar.print')
  printBtn.setAttribute('aria-label', t(c._lang, 'toolbar.print'))
  printBtn.addEventListener('click', () => {
    openPrintView(c.editor.getHTML(), c.getAttribute('document-name') || 'Dokument')
  })
  bar.appendChild(printBtn)

  // Word count + reading time (updated with the 1 s markdown debounce)
  c._wordCountEl = document.createElement('span')
  c._wordCountEl.className = 'mce-wordcount'
  c._wordCountEl.title = t(c._lang, 'editor.wordCountTitle')
  bar.appendChild(c._wordCountEl)

  bar.appendChild(c._usersEl)
  bar.appendChild(c._saveBar.build())

  // WAI-ARIA toolbar pattern: one tab stop, arrow keys move between buttons
  const rovingButtons = () =>
    [...bar.querySelectorAll('button')].filter((b) => b.style.display !== 'none' && !b.disabled)
  const setRoving = (target) => {
    for (const b of bar.querySelectorAll('button')) b.tabIndex = -1
    target.tabIndex = 0
  }
  setRoving(c._buttons[0].btn)
  bar.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return
    const btns = rovingButtons()
    const i = btns.indexOf(document.activeElement)
    if (i === -1) return
    e.preventDefault()
    const n = e.key === 'ArrowRight' ? (i + 1) % btns.length
      : e.key === 'ArrowLeft' ? (i - 1 + btns.length) % btns.length
      : e.key === 'Home' ? 0 : btns.length - 1
    setRoving(btns[n])
    btns[n].focus()
  })
  // Clicking a button makes it the tab stop
  bar.addEventListener('focusin', (e) => {
    if (e.target.matches('button')) setRoving(e.target)
  })

  c._updateToolbar()
  c._syncImageButton() // 🖼 tooltip reflects the injected capabilities
  c._saveBar.render()
}
