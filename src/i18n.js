/**
 * Minimal i18n for the collaborative markdown editor (host page + the
 * <md-collab-editor> web component). No framework: language is chosen once
 * (localStorage on the host, the `lang` attribute on the component) — there
 * is no live re-rendering of already-open UI when the language changes, the
 * host reloads the page instead (see src/host.js).
 *
 * IMPORTANT — persisted data stays German regardless of UI language: the
 * default entity-type CATALOG VALUES (src/entity-types.js) are the literal
 * text stored in edu-sharing's `cclom:general_keyword` ("Weimar (Ort)").
 * Only their on-screen LABEL is translated; the stored value is unaffected
 * so existing tagged documents keep working no matter which UI language
 * created or later edits them.
 */
export const LANGS = ['de', 'en']
export const DEFAULT_LANG = 'de'
const STORAGE_KEY = 'mce_lang'

/** Read the persisted UI language preference (host page only). */
export function detectLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return LANGS.includes(stored) ? stored : DEFAULT_LANG
  } catch {
    return DEFAULT_LANG // storage unavailable (e.g. sandboxed iframe)
  }
}

/** Persist the UI language preference (host page only). */
export function setLang(lang) {
  if (!LANGS.includes(lang)) return
  try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
}

// Module-level "active" language for code that has no direct access to the
// host/component (e.g. the static TOOLBAR button definitions in
// toolbar.js). Set once by <md-collab-editor> right before it renders.
let activeLang = DEFAULT_LANG
export function setActiveLang(lang) {
  activeLang = LANGS.includes(lang) ? lang : DEFAULT_LANG
}
export function getActiveLang() {
  return activeLang
}

const MESSAGES = {
  de: {
    // Toolbar (src/toolbar.js)
    'toolbar.bold': 'Fett',
    'toolbar.italic': 'Kursiv',
    'toolbar.strike': 'Durchgestrichen',
    'toolbar.code': 'Inline-Code',
    'toolbar.sup': 'Hochgestellt',
    'toolbar.sub': 'Tiefgestellt',
    'toolbar.h1': 'Überschrift 1',
    'toolbar.h2': 'Überschrift 2',
    'toolbar.h3': 'Überschrift 3',
    'toolbar.bulletList': 'Liste',
    'toolbar.orderedList': 'Nummerierte Liste',
    'toolbar.taskList': 'Task-Liste',
    'toolbar.blockquote': 'Zitat',
    'toolbar.codeBlock': 'Code-Block',
    'toolbar.hr': 'Trennlinie',
    'toolbar.link': 'Link',
    'toolbar.image': 'Bild (URL)',
    'toolbar.table': 'Tabelle einfügen (3×3)',
    'toolbar.rowAdd': 'Zeile darunter einfügen',
    'toolbar.colAdd': 'Spalte rechts einfügen',
    'toolbar.rowDel': 'Zeile löschen',
    'toolbar.colDel': 'Spalte löschen',
    'toolbar.tableDel': 'Tabelle löschen',
    'toolbar.undo': 'Rückgängig',
    'toolbar.redo': 'Wiederholen',
    'toolbar.linkPrompt': 'Link-URL (leer = entfernen):',
    'toolbar.imagePrompt': 'Bild-URL:',

    // <md-collab-editor> shell (src/md-collab-editor.js)
    'editor.toolbarLabel': 'Textformatierung',
    'editor.entitiesLabel': 'Getaggte Entitäten',
    'editor.placeholder': 'Kompendialer Text …',
    'editor.tagButtonLabel': '🏷 Entität',
    'editor.tagButtonTitle': 'Auswahl als Entität taggen',
    'editor.missingDocumentName': 'md-collab-editor: Attribut document-name fehlt',
    'editor.notInitialized': 'Editor nicht initialisiert',
    'editor.saveButton': 'Speichern',
    'editor.saveTimeoutError': 'Zeitüberschreitung — bitte erneut speichern',
    'editor.saveFailedFallback': 'Speichern fehlgeschlagen',
    'users.self': ' (du)',
    'users.editingTitle': '{name} bearbeitet gerade',
    'users.connectedTitle': '{name} ist verbunden',

    // Save bar (src/save-state.js)
    'saveBar.readonly': 'wird nicht gespeichert',
    'saveBar.readonlyTitle': 'Keine Schreib-Session am Server (Anmeldung/Schreibrecht nötig)',
    'saveBar.saving': 'speichere …',
    'saveBar.error': 'Speicherfehler',
    'saveBar.offlineDirty': 'ungespeichert · Auto-Speichern aus',
    'saveBar.pendingCountdown': 'speichert in {secs}s',
    'saveBar.pendingNow': 'speichert gleich …',
    'saveBar.saved': 'gespeichert {time}',
    'saveBar.noChanges': 'keine Änderungen',

    // Tag dialog (src/annotation-ui.js)
    'tag.typeLabel': 'Typ',
    'tag.typePlaceholder': 'z. B. Person, Ort, Fachbegriff',
    'tag.entityIdLabel': 'Entity-ID',
    'tag.entityIdOptional': '(optional)',
    'tag.entityIdPlaceholder': 'z. B. keyword:xyz oder Node-ID',
    'tag.submit': 'Taggen',
    'tag.cancel': 'Abbrechen',
    'tag.typeRequiredError': 'Bitte einen Typ angeben.',
    'manage.title': 'Entitäten an dieser Stelle',
    'manage.deleteTitle': 'Tag entfernen',
    'chips.orphanTitle': '„{quote}" kommt nicht mehr im Text vor — wird beim Speichern trotzdem als Keyword geführt',
    'chips.entityIdTitle': 'Entity: {id}',
    'chips.selectTitle': 'Klick: Stelle anzeigen',
    'chips.deleteTitle': 'Tag entfernen',
    'chips.deleteAriaLabel': 'Tag {label} entfernen',

    // Annotation controller (src/annotation-controller.js)
    'controller.quoteTypeRequired': 'quote und type sind erforderlich',
    'controller.quoteNotFound': 'Zitat nicht im Text gefunden: „{quote}"',
    'controller.quoteTooLong': 'Auswahl ist zu lang (max. {max} Zeichen).',
    'controller.noBlockSpan': 'Die Auswahl darf keine Absätze überspannen.',
    'controller.invalidType': 'Ungültiger Typ — Klammern sind nicht erlaubt (der Typ wird als „Name (Typ)" gespeichert).',
    'controller.crossing': 'Kreuzt bestehendes Tag „{label}" — erlaubt sind nur verschachtelte oder deckungsgleiche Tags.',

    // Host page (src/host.js)
    'host.loginChecking': 'Prüfe Anmeldung …',
    'host.loginFailedDefault': 'Anmeldung fehlgeschlagen',
    'host.ticketLoginFailedDefault': 'Ticket-Anmeldung fehlgeschlagen',
    'host.connConnected': 'verbunden',
    'host.connConnecting': 'verbinde …',
    'host.connDisconnected': 'getrennt',
    'host.loading': 'Lade …',
    'host.nodeUnreachable': 'Knoten nicht erreichbar',
    'host.saveTarget': 'Speicherziel: {label}',
    'host.saveNowIdle': 'Jetzt speichern',
    'host.saveNowSaving': 'Speichere …',
    'host.blockedDefault': 'Bearbeitung für diesen Knoten nicht möglich.',
    'host.readonlyWithAccount': 'Nur-Lesen: dein Account hat kein Schreibrecht auf diesen Knoten.',
    'host.readonlyNoAccount': 'Nur-Lesen: ohne Anmeldung werden Änderungen nicht gespeichert.',
    'host.saveErrorPrefix': 'Speicherfehler: {err}',
    'host.pendingNoAutosave': 'Ungespeicherte Änderungen im Puffer — Auto-Speichern ist aus, „Jetzt speichern" nutzen.',
    'host.pendingAutosave': 'Änderungen im Puffer — Speicherung folgt automatisch (~{secs}s nach der letzten Eingabe, sofort beim Verlassen).',
    'host.savedAt': 'Gespeichert ins Repo um {time}.',
    'host.idleLoaded': 'Stand aus dem Repo geladen — Änderungen werden gepuffert und automatisch gespeichert.',
    'host.anonymousName': 'Anonym',
    'host.ticketUserName': 'Ticket-Nutzer',
    'host.shareLabel': 'Link teilen für gemeinsames Bearbeiten:',

    // Static host page markup (public/index.html, applied via data-i18n*)
    'app.title': 'edu-sharing · Kollaborativer Markdown-Editor (Demo)',
    'brand.h1': 'Kompendium-Editor',
    'brand.subtitle': 'Kollaborative Bearbeitung kompendialer Texte auf edu-sharing-Knoten (WLO-Staging).',
    'section1.h2': '1 · Anmeldung',
    'login.username': 'Benutzername',
    'login.password': 'Passwort',
    'login.submit': 'Anmelden',
    'login.hint': 'WLO-Staging-Account. Ohne Anmeldung: nur Mitlesen.',
    'login.loggedInAs': 'Angemeldet als',
    'login.logout': 'abmelden',
    'section2.h2': '2 · Inhalt wählen',
    'open.nodeIdLabel': 'Node-ID (Sammlung oder Inhalt)',
    'open.nameLabel': 'Dein Anzeigename',
    'open.namePlaceholder': 'z. B. Jan',
    'open.targetLegend': 'Speicherziel',
    'open.targetCompendium': 'Kompendium-Property <code>ccm:oeh_collection_compendium_text</code>',
    'open.targetDescription': 'Beschreibungsfeld (Alternative)',
    'open.submit': 'Dokument öffnen',
    'open.hint': 'Vorbelegt: Inhalt „Kartoffel" (ccm:io). Sammlungen funktionieren genauso — einfach eine ccm:map-Node-ID eintragen.',
    'section3.h2': '3 · Dokument',
    'doc.renderLink': 'im Repo ansehen ↗',
    'doc.autosaveTitle': 'Automatisches Schreiben ins Repository',
    'doc.autosaveLabel': 'Auto-Speichern',
    'doc.autosaveWarn': 'Auto-Speichern ist aus — ungespeicherte Änderungen gehen beim Verlassen der Sitzung verloren.',
    'editorEmpty.text': '◀ Links anmelden und einen Inhalt wählen.<br>Der Editor erscheint hier als <code>&lt;md-collab-editor&gt;</code>-Web-Component.',
    'lang.switchLabel': 'Sprache',
    'doc.saveLedTitle': 'Speicherstatus',
  },
  en: {
    'toolbar.bold': 'Bold',
    'toolbar.italic': 'Italic',
    'toolbar.strike': 'Strikethrough',
    'toolbar.code': 'Inline code',
    'toolbar.sup': 'Superscript',
    'toolbar.sub': 'Subscript',
    'toolbar.h1': 'Heading 1',
    'toolbar.h2': 'Heading 2',
    'toolbar.h3': 'Heading 3',
    'toolbar.bulletList': 'Bullet list',
    'toolbar.orderedList': 'Numbered list',
    'toolbar.taskList': 'Task list',
    'toolbar.blockquote': 'Quote',
    'toolbar.codeBlock': 'Code block',
    'toolbar.hr': 'Horizontal rule',
    'toolbar.link': 'Link',
    'toolbar.image': 'Image (URL)',
    'toolbar.table': 'Insert table (3×3)',
    'toolbar.rowAdd': 'Insert row below',
    'toolbar.colAdd': 'Insert column right',
    'toolbar.rowDel': 'Delete row',
    'toolbar.colDel': 'Delete column',
    'toolbar.tableDel': 'Delete table',
    'toolbar.undo': 'Undo',
    'toolbar.redo': 'Redo',
    'toolbar.linkPrompt': 'Link URL (empty = remove):',
    'toolbar.imagePrompt': 'Image URL:',

    'editor.toolbarLabel': 'Text formatting',
    'editor.entitiesLabel': 'Tagged entities',
    'editor.placeholder': 'Compendium text …',
    'editor.tagButtonLabel': '🏷 Entity',
    'editor.tagButtonTitle': 'Tag selection as entity',
    'editor.missingDocumentName': 'md-collab-editor: document-name attribute missing',
    'editor.notInitialized': 'Editor not initialized',
    'editor.saveButton': 'Save',
    'editor.saveTimeoutError': 'Timed out — please save again',
    'editor.saveFailedFallback': 'Save failed',
    'users.self': ' (you)',
    'users.editingTitle': '{name} is editing',
    'users.connectedTitle': '{name} is connected',

    'saveBar.readonly': 'not being saved',
    'saveBar.readonlyTitle': 'No write session on the server (login/write permission required)',
    'saveBar.saving': 'saving …',
    'saveBar.error': 'Save error',
    'saveBar.offlineDirty': 'unsaved · autosave off',
    'saveBar.pendingCountdown': 'saving in {secs}s',
    'saveBar.pendingNow': 'saving now …',
    'saveBar.saved': 'saved {time}',
    'saveBar.noChanges': 'no changes',

    'tag.typeLabel': 'Type',
    'tag.typePlaceholder': 'e.g. Person, Place, Term',
    'tag.entityIdLabel': 'Entity ID',
    'tag.entityIdOptional': '(optional)',
    'tag.entityIdPlaceholder': 'e.g. keyword:xyz or node ID',
    'tag.submit': 'Tag',
    'tag.cancel': 'Cancel',
    'tag.typeRequiredError': 'Please enter a type.',
    'manage.title': 'Entities at this spot',
    'manage.deleteTitle': 'Remove tag',
    'chips.orphanTitle': '"{quote}" no longer appears in the text — will still be kept as a keyword when saved',
    'chips.entityIdTitle': 'Entity: {id}',
    'chips.selectTitle': 'Click to jump to this spot',
    'chips.deleteTitle': 'Remove tag',
    'chips.deleteAriaLabel': 'Remove tag {label}',

    'controller.quoteTypeRequired': 'quote and type are required',
    'controller.quoteNotFound': 'Quote not found in the text: "{quote}"',
    'controller.quoteTooLong': 'Selection is too long (max. {max} characters).',
    'controller.noBlockSpan': 'The selection may not span multiple paragraphs.',
    'controller.invalidType': 'Invalid type — parentheses are not allowed (the type is stored as "Name (Type)").',
    'controller.crossing': 'Crosses an existing tag "{label}" — only nested or identical tags are allowed.',

    'host.loginChecking': 'Checking login …',
    'host.loginFailedDefault': 'Login failed',
    'host.ticketLoginFailedDefault': 'Ticket login failed',
    'host.connConnected': 'connected',
    'host.connConnecting': 'connecting …',
    'host.connDisconnected': 'disconnected',
    'host.loading': 'Loading …',
    'host.nodeUnreachable': 'Node unreachable',
    'host.saveTarget': 'Save target: {label}',
    'host.saveNowIdle': 'Save now',
    'host.saveNowSaving': 'Saving …',
    'host.blockedDefault': 'Editing is not possible for this node.',
    'host.readonlyWithAccount': 'Read-only: your account has no write permission on this node.',
    'host.readonlyNoAccount': 'Read-only: without logging in, changes are not saved.',
    'host.saveErrorPrefix': 'Save error: {err}',
    'host.pendingNoAutosave': 'Unsaved changes buffered — autosave is off, use "Save now".',
    'host.pendingAutosave': 'Changes buffered — will be saved automatically (~{secs}s after the last edit, immediately on leaving).',
    'host.savedAt': 'Saved to the repository at {time}.',
    'host.idleLoaded': 'Loaded from the repository — changes are buffered and saved automatically.',
    'host.anonymousName': 'Anonymous',
    'host.ticketUserName': 'Ticket user',
    'host.shareLabel': 'Share this link to edit together:',

    'app.title': 'edu-sharing · Collaborative Markdown Editor (Demo)',
    'brand.h1': 'Compendium Editor',
    'brand.subtitle': 'Collaborative editing of compendium texts on edu-sharing nodes (WLO staging).',
    'section1.h2': '1 · Login',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.submit': 'Log in',
    'login.hint': 'WLO staging account. Without login: read-only.',
    'login.loggedInAs': 'Logged in as',
    'login.logout': 'log out',
    'section2.h2': '2 · Choose content',
    'open.nodeIdLabel': 'Node ID (collection or content)',
    'open.nameLabel': 'Your display name',
    'open.namePlaceholder': 'e.g. Jan',
    'open.targetLegend': 'Save target',
    'open.targetCompendium': 'Compendium property <code>ccm:oeh_collection_compendium_text</code>',
    'open.targetDescription': 'Description field (alternative)',
    'open.submit': 'Open document',
    'open.hint': 'Preset: content "Kartoffel" (ccm:io). Collections work the same way — just enter a ccm:map node ID.',
    'section3.h2': '3 · Document',
    'doc.renderLink': 'view in repository ↗',
    'doc.autosaveTitle': 'Automatically write to the repository',
    'doc.autosaveLabel': 'Autosave',
    'doc.autosaveWarn': 'Autosave is off — unsaved changes are lost when you leave the session.',
    'editorEmpty.text': '◀ Log in on the left and choose a content.<br>The editor will appear here as a <code>&lt;md-collab-editor&gt;</code> web component.',
    'lang.switchLabel': 'Language',
    'doc.saveLedTitle': 'Save status',
  },
}

/** All message keys defined for a language (testing/tooling only — lets a
 * parity check catch a key added to one language but not the other, which
 * would otherwise silently fall back to the raw key at runtime). */
export function messageKeys(lang) {
  return Object.keys(MESSAGES[lang] || {})
}

/**
 * Look up a message and substitute `{placeholders}`. Falls back to the
 * default language, then to the raw key, so a missing translation never
 * breaks the UI.
 */
export function t(lang, key, vars = {}) {
  const dict = MESSAGES[lang] || MESSAGES[DEFAULT_LANG]
  let msg = dict[key] ?? MESSAGES[DEFAULT_LANG][key] ?? key
  for (const [k, v] of Object.entries(vars)) msg = msg.replaceAll(`{${k}}`, v)
  return msg
}

/** Shorthand using the module-level active language (see setActiveLang). */
export function tt(key, vars = {}) {
  return t(activeLang, key, vars)
}
