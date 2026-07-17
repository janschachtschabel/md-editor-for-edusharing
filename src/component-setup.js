/**
 * Construction + wiring for <md-collab-editor> (extracted from the component,
 * audit M-3 follow-up): builds the feature controllers (save bar, find,
 * AI review, comments, annotations, roles, presence), the Hocuspocus provider
 * and the TipTap editor, renders the toolbar and applies the initial mode.
 * Pure behavior-preserving move — `c` is the component instance; everything
 * is assigned onto it exactly as before.
 */
import { Editor } from '@tiptap/core'
import { Placeholder } from '@tiptap/extensions'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { createExtensions } from './extensions.js'
import { SaveBarUi } from './save-bar.js'
import { AnnotationDecorations } from './annotation-extension.js'
import { AnnotationController } from './annotation-controller.js'
import { PresenceTracker } from './presence.js'
import { RoleUi } from './role-ui.js'
import { FindReplaceUi } from './find-replace.js'
import { AiReviewUi } from './ai-review.js'
import { CommentsUi } from './comments-ui.js'
import { CommentMarks } from './comment-marks.js'
import { MediaUi } from './media-ui.js'
import { findHeadingBySlug } from './toc.js'
import { t } from './i18n.js'

export function setupComponent(c, { wsUrl, documentName, token, userName, userColor, readOnly }) {
  // Save bar (LED + countdown + "Speichern" button) — state, DOM and server
  // events live in the controller (src/save-bar.js)
  c._saveBar = new SaveBarUi({
    getLang: () => c._lang,
    sendSave: () => c.provider.sendStateless(JSON.stringify({ event: 'save' })),
    onStateChange: (state) => c._emit('save-state-change', state),
  })

  c.provider = new HocuspocusProvider({
    url: wsUrl,
    name: documentName,
    token: token || 'anonymous',
    onStatus: ({ status }) => c._emit('status-change', { status }),
    // The server REJECTS presented-but-invalid tokens (expired 8 h session,
    // logout on another tab/device). Stop the provider's reconnect loop —
    // every retry would be rejected again — and tell the host WHY, instead
    // of showing a bare "disconnected" (audit UX-1).
    onAuthenticationFailed: () => {
      c.provider.disconnect()
      c._emit('status-change', { status: 'session-expired' })
    },
    onSynced: () => {
      c._saveBar.markSynced()
      // Ask the server for the save state (answered by a config broadcast)
      c.provider.sendStateless(JSON.stringify({ event: 'hello' }))
      c._emit('synced', {})
    },
    onStateless: ({ payload }) => c._onStateless(payload),
  })

  // Standoff annotations: shared Y.Array in the SAME Yjs document as the
  // text — tags and text synchronize over one channel and are seeded/
  // persisted together by the server (general keywords "Name (Typ)").
  // Feature logic lives in the controller (src/annotation-controller.js).
  c._tags = new AnnotationController({
    root: c,
    entitiesEl: c._entitiesEl,
    annotations: c.provider.document.getArray('annotations'),
    getEditor: () => c.editor,
    getLang: () => c._lang,
    getLocked: () => c._plainKeywords || [],
    onChange: () => c._onAnnotationsChanged(),
  })

  // Paragraph-role UI (select + amber chips bar) — src/role-ui.js
  c._roles = new RoleUi({
    rolesEl: c._rolesEl,
    getEditor: () => c.editor,
    getLang: () => c._lang,
  })

  // Find & replace bar — src/find-replace.js
  c._find = new FindReplaceUi({
    barEl: c.querySelector('.mce-find'),
    getEditor: () => c.editor,
    getLang: () => c._lang,
  })
  c._find.build()

  // AI suggestion review (server sends validated suggestions for approval)
  c._aiReview = new AiReviewUi({
    barEl: c.querySelector('.mce-ai-review'),
    getLang: () => c._lang,
    sendCommand: (obj) => c.provider.sendStateless(JSON.stringify(obj)),
  })

  // Node comments (host injects el.commentsApi) — src/comments-ui.js
  c._comments = new CommentsUi({
    panelEl: c.querySelector('.mce-comments'),
    getEditor: () => c.editor,
    getLang: () => c._lang,
    getApi: () => c._commentsApi,
    // The list loads async — the component may already be unmounted (editor
    // destroyed) when it arrives, so never touch a destroyed editor
    onItemsChanged: () => {
      if (c.editor && !c.editor.isDestroyed) c.editor.commands.refreshCommentMarks()
    },
  })

  // Media management (host injects el.mediaApi) — src/media-ui.js
  c._media = new MediaUi({
    panelEl: c.querySelector('.mce-media'),
    getEditor: () => c.editor,
    getMarkdown: () => c.getMarkdown(),
    getLang: () => c._lang,
    getApi: () => c._mediaApi,
    getUploader: () => (c.uploadImage ? () => c._pickImage() : null),
  })

  // Presence: awareness tracking + chips live in src/presence.js (F-T5);
  // the component only re-emits the user list as its public event
  c._presence = new PresenceTracker({
    provider: c.provider,
    usersEl: c._usersEl,
    getLang: () => c._lang,
    onUsers: (users) => c._emit('users-change', { users }),
    onJumpTo: (clientId) => c._jumpToUser(clientId),
  })

  c.editor = new Editor({
    element: c.querySelector('.mce-editor'),
    editable: !readOnly && c.getAttribute('viewer') !== 'true',
    extensions: [
      ...createExtensions(),
      Placeholder.configure({ placeholder: t(c._lang, 'editor.placeholder') }),
      AnnotationDecorations.configure({
        getAnnotations: () => c._tags.raw(),
        onAnnotationClick: (hits, event) => c._tags.handleClick(hits, event),
      }),
      // In-text marks for »quote«-anchored node comments (src/comment-marks.js)
      CommentMarks.configure({
        getAnchors: () => c._comments.anchoredQuotes(),
        getLang: () => c._lang,
        onCommentClick: (ids) => c._comments.openAt(ids[0]),
      }),
      Collaboration.configure({ document: c.provider.document }),
      CollaborationCaret.configure({
        provider: c.provider,
        user: { name: userName, color: userColor },
      }),
    ],
    onTransaction: () => c._updateToolbar(),
    onUpdate: () => {
      c._scheduleMarkdownEmit()
      c._roles.renderChips() // roles live in the doc → refresh on every change
      // Track changes (own AND remote) for the save countdown
      c._saveBar.noteChange()
    },
    onCreate: () => c._emit('editor-ready', { editor: c.editor }),
  })

  c._renderToolbar()
  c._tags.renderChips()
  c._roles.renderChips()
  c._renderWordCount()
  c._applyMode() // initial read-only/viewer attributes
  // Comment marks need the list before the panel is ever opened (the host may
  // have injected the API before mount — the post-mount setter path preloads too)
  if (c._commentsApi) c._comments.preload()

  // Jump marks: anchor links (the in-content TOC, src/toc.js) resolve to
  // their heading INSIDE the editor — in edit and viewer mode alike.
  // External renderers resolve the same #slugs via their auto-anchors.
  c.querySelector('.mce-editor').addEventListener('click', (e) => {
    const a = e.target?.closest?.('a[href^="#"]')
    if (!a) return
    e.preventDefault()
    const pos = findHeadingBySlug(c.editor.state.doc, a.getAttribute('href').slice(1))
    if (pos !== null) c.editor.chain().setTextSelection(pos + 1).scrollIntoView().run()
  })
}
