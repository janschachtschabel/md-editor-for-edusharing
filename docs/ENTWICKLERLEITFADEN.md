# Entwicklerleitfaden — Kollaborativer Markdown-Editor für edu-sharing

Diese Datei richtet sich an Entwickler:innen, die den Code **produktiv machen**
oder in die WLO-/edu-sharing-Infrastruktur **integrieren**. Sie erklärt, womit
das System gebaut ist, was fertig nachgenutzt und was selbst entwickelt wurde,
wie Daten übertragen werden, wie Auth funktioniert, was für Sicherheit und
Skalierung relevant ist, wie die Einbettung (als Angular-nutzbare Web Component)
erfolgt — und wie das semantische Tagging (Standoff-Annotationen → Keywords)
umgesetzt ist.

- **Repo:** <https://github.com/janschachtschabel/md-editor-for-edusharing>
- **Nutzerhandbücher:** [`README.md`](../README.md) (DE) · [`README.en.md`](../README.en.md) (EN)
- **Audits:** [`docs/audits/`](audits/)

---

## Inhalt

1. [Anforderungen an die Auswahl](#1-anforderungen-an-die-auswahl)
2. [Warum dieser Stack? (Begründung der Tool-Wahl)](#2-warum-dieser-stack-begründung-der-tool-wahl)
3. [Die Bausteine im Detail — Funktion & Lizenz](#3-die-bausteine-im-detail--funktion--lizenz)
4. [Fertig nachgenutzt vs. selbst entwickelt](#4-fertig-nachgenutzt-vs-selbst-entwickelt)
5. [Markdown-Handling (Laden · Editieren · Speichern)](#5-markdown-handling-laden--editieren--speichern)
6. [Architektur & Datenkommunikation](#6-architektur--datenkommunikation)
7. [Authentifizierung & Sessions](#7-authentifizierung--sessions)
8. [edu-sharing-Anbindung (Speicherung in Metadaten)](#8-edu-sharing-anbindung-speicherung-in-metadaten)
9. [Sync-Strategie & Timing](#9-sync-strategie--timing)
10. [Die Web Component & Angular-Einbettung](#10-die-web-component--angular-einbettung)
11. [Was hinzugefügt wurde (Toolbar, Presence, Save-Bar, Test-Anbindung)](#11-was-hinzugefügt-wurde)
12. [Sicherheit](#12-sicherheit)
13. [Skalierung & Produktivsetzung](#13-skalierung--produktivsetzung)
14. [Semantisches Tagging (umgesetzt)](#14-semantisches-tagging-umgesetzt)
15. [Projektstruktur (Referenzdateien)](#15-projektstruktur-referenzdateien)

---

## 1. Anforderungen an die Auswahl

Der Editor wurde gegen fünf Muss-Kriterien ausgewählt:

- **Markdown-Support** — kompendiale Texte liegen als Markdown vor.
- **Frei nachnutzbare Lizenz** — kommerziell/öffentlich betreibbar, kein Copyleft-Risiko.
- **Technisch leicht einbindbar** — als Bibliothek in die bestehende edu-sharing-UI, nicht als Fremddienst.
- **Kollaborative Bearbeitung** — mehrere Redakteur:innen gleichzeitig in Echtzeit.
- **UX-Anpassung möglich** — eigene Toolbar/Optik im edu-sharing-Look.

---

## 2. Warum dieser Stack? (Begründung der Tool-Wahl)

Gewählt wurde **TipTap + Yjs + Hocuspocus** (alle MIT). Die naheliegende
Alternative wäre das bekannte **HedgeDoc** gewesen — bewusst *nicht* genommen:

| Kriterium | TipTap + Yjs + Hocuspocus | HedgeDoc |
|---|---|---|
| **Lizenz** | komplett **MIT** — kein Offenlegungsrisiko | **AGPL-3.0** — bei öffentlichem Betrieb Offenlegungspflicht |
| **Einbettung** | npm-Bibliothek, direkt in die edu-sharing-**Angular-UI** integrierbar | fertiges **Server-Produkt** — nur per iFrame/Link koppelbar |
| **UI-Kontrolle** | **headless** → eigene Toolbar, Presence, Save-Bar im edu-sharing-Look | fixes Fremd-UI |
| **Kollaborationsmodell** | **Yjs/CRDT** — konfliktfrei, offline-fähig | älteres **OT**, ohne Offline-Merge |
| **Ökosystem/Reife** | ~37,4k ★, produktionsbewährt (u. a. GitLab, Substack) | 1.x im Wartungsmodus, 2.0 in Alpha → Migrationsrisiko |

**Kurzbegründung je Baustein:**

- **TipTap** — headless heißt: volle Kontrolle über das UI. Wir bauen Toolbar,
  Presence-Chips und Save-Bar selbst, exakt im gewünschten Look — statt ein
  fremdes UI zu übernehmen und zu überschreiben.
- **Yjs (CRDT)** — konfliktfreies Verschmelzen gleichzeitiger Änderungen ist
  gelöst, ohne eigene Merge-Logik. Modernes Paradigma statt OT.
- **Hocuspocus** — fertiges, gepflegtes WebSocket-Backend für Yjs mit Hooks für
  Auth und Persistenz (spart einen eigenen Sync-Server).
- **marked + turndown** — ausgereifte, weit verbreitete Markdown-Konverter statt
  des unfertigen `@tiptap/markdown` (siehe [§5](#5-markdown-handling-laden--editieren--speichern)).

**Gute Alternative** (falls je nötig): Milkdown + Yjs (ebenfalls MIT).

---

## 3. Die Bausteine im Detail — Funktion & Lizenz

Alle produktiven Abhängigkeiten sind **permissiv lizenziert** (MIT/BSD/ISC,
**kein Copyleft**). Vollständige Liste: [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).

### Editor-Kern

| Baustein | Version | Funktion | Lizenz |
|---|---|---|---|
| **TipTap** (`@tiptap/core`, `starter-kit`) | v3 | Headless WYSIWYG-Editor auf ProseMirror-Basis; liefert Dokumentschema, Eingaberegeln, Formatier-Befehle | MIT |
| **ProseMirror** (`@tiptap/pm`) | — | Die eigentliche Editor-Engine unter TipTap: hält das Dokument als Knoten-Baum, wendet Änderungen als „Transaktionen" an | MIT |

### Kollaboration

| Baustein | Version | Funktion | Lizenz |
|---|---|---|---|
| **Yjs** | v13 | CRDT — konfliktfreie Echtzeit-Synchronisation des Dokuments zwischen Nutzern; kein eigener Merge-Code nötig | MIT |
| **Hocuspocus** (`@hocuspocus/server`, `provider`, `transformer`) | v4 | Yjs-WebSocket-Backend: Verbindungs-/Reconnect-Handling, Dokument-Lifecycle (Laden/Entladen), Debounce-Mechanik für Speicher-Hooks, serverseitiges Read-only-Gate, Stateless-Nachrichtenkanal, TipTap-JSON ⇄ Yjs | MIT |
| `@tiptap/extension-collaboration` | v3 | Kopplung des Editors an das Yjs-Dokument | MIT |
| `@tiptap/extension-collaboration-caret` | v3 | Live-Cursor/-Markierungen der anderen Nutzer | MIT |
| **crossws** | v0.4 | WebSocket-Upgrade-Adapter (von Hocuspocus v4 für die Server-Integration genutzt) | MIT |

### Markdown-Konvertierung

| Baustein | Version | Funktion | Lizenz |
|---|---|---|---|
| **marked** | v18 | Markdown → HTML (GFM eingebaut, per Config aktiviert) | MIT |
| **turndown** | v7 | HTML → Markdown | MIT |
| **turndown-plugin-gfm** | v1 | **Das einzige Plugin**: GFM-Tabellen + Durchstreichung beim Speichern | MIT |

### Server & Build

| Baustein | Funktion | Lizenz |
|---|---|---|
| **Express** (v5) | HTTP-Server (statisches Frontend + REST-API) | MIT |
| **dotenv** | Konfiguration aus `.env` | BSD-2-Clause |
| **esbuild** (dev) | Bundler für die Browser-Bundles | MIT |
| **eslint** (dev) | Linting der gesamten Codebasis | MIT |

### Genutzte TipTap-Extensions (alle MIT)

Aus dem StarterKit: Überschriften, Fett/Kursiv/Durchgestrichen, Inline-Code &
Code-Blöcke, Listen, Zitate, Trennlinien, **Links** (seit v3 im StarterKit).
Bewusst **deaktiviert**: `underline` (keine Markdown-Entsprechung) und `undoRedo`
(Undo/Redo übernimmt Yjs). Zusätzlich einzeln eingebunden:

- `@tiptap/extension-table` — **Tabellen** (Table, TableRow, TableHeader, TableCell)
- `@tiptap/extension-list` — **Task-Listen** (TaskList, TaskItem) für `- [x]`
- `@tiptap/extension-image` — Bilder
- `@tiptap/extension-superscript` / `-subscript` — Hoch-/Tiefstellung (für Formeln)
- `@tiptap/extensions` — Placeholder
- `@tiptap/html` — `generateHTML`/`generateJSON` (serverseitig genutzt)

Das komplette, auf **beiden Seiten identische** Set liegt in
[`src/extensions.js`](../src/extensions.js). Auswahlkriterium: **alles muss
verlustfrei in Markdown (GFM) abbildbar sein**.

---

## 4. Fertig nachgenutzt vs. selbst entwickelt

### Unverändert aus den Bibliotheken übernommen (nur konfiguriert)

- **Editier-Verhalten** komplett von TipTap/ProseMirror (Schema, Eingaberegeln, Befehle).
- **Konfliktfreie Kollaboration** von Yjs (CRDT-Merging).
- **WebSocket-Sync + Dokument-Lifecycle + Debounce-Mechanik** von Hocuspocus.
- **Markdown-Parsing/Serialisierung** von marked bzw. turndown (+ 1 Plugin).

### Eigenentwicklung dieses Projekts

| Teil | Datei | Warum selbst gebaut |
|---|---|---|
| **`<md-collab-editor>`** Web Component | [`src/md-collab-editor.js`](../src/md-collab-editor.js) | TipTap ist headless — Toolbar, Presence-Chips, Save-Bar, Tastaturnavigation, ARIA gibt es dort nicht |
| **Toolbar-Definition** | [`src/toolbar.js`](../src/toolbar.js) | Symbol-Buttons + Tabellen-Kontextaktionen |
| **Save-Bar-Logik** (pur, getestet) | [`src/save-state.js`](../src/save-state.js) | LED-Zustand + Countdown-Berechnung |
| **Save-Bar-Controller** | [`src/save-bar.js`](../src/save-bar.js) | DOM, Speichern-Button, Server-Events (`config`/`saved`/`save-error`), Countdown-Ticker |
| **Markdown-Regelwerk** | [`src/markdown.js`](../src/markdown.js) | verlustfreier Roundtrip: Task-Listen, Tabellen-`colgroup`-Fix, kompakte Zellen/Listen, Sup/Sub, Strike |
| **edu-sharing-API-Client** | [`server/edu-sharing-api.js`](../server/edu-sharing-api.js) | Lesen/Schreiben, `setProperty`-Umweg, Access-Check, Read-Back |
| **Persistenz-Regelung** | [`server/collab.js`](../server/collab.js) | Puffer-Strategie, Änderungserkennung, Retry, Status-Broadcast |
| **Session-Store** | [`server/sessions.js`](../server/sessions.js) | opake Tokens, TTL, Revoke |
| **Sicherheits-Guards** | [`server/guards.js`](../server/guards.js) | Rate-Limit, WS-Origin-Check, Node-ID-Validierung |
| **KI-Verschlagwortung** | [`server/ai-tagging.js`](../server/ai-tagging.js) | gekapseltes Server-Modul: B-API-Call (OpenAI-Passthrough), Validierung der KI-Vorschläge wie Nutzereingaben, Anwendung auf das geteilte Yjs-Dokument, Presence-Auftritt „🤖 KI-Tagger" |
| **Host-Seite** (Referenz-Einbettung) | [`src/host.js`](../src/host.js) | zeigt die Web-Component-Nutzung + Test-API-Anbindung |
| **Testsuiten, CI, Docker** | `test/`, `.github/`, `.gitlab-ci.yml`, `Dockerfile` | Qualitätssicherung + Deployment |

---

## 5. Markdown-Handling (Laden · Editieren · Speichern)

**Wichtigstes Konzept:** Markdown existiert **nur an der Grenze zum Repository**.
Während des Editierens gibt es kein Markdown — der Editor arbeitet auf einem
**Knoten-Baum** (ProseMirror-Dokument, gespiegelt als Yjs-CRDT).

### Laden (rein)

```
Repo-Markdown → marked (GFM) → HTML → TipTap generateJSON → ProseMirror-/Yjs-Knoten
```

`marked` (mit eingebautem GFM) wandelt den Markdown-Text in HTML; TipTaps
`generateJSON` macht daraus die Knotenstruktur. HTML ist nur Durchgangsstation —
direkt danach verworfen.

### Editieren (dazwischen)

**Kein Text/Markdown** — ein **Baukasten aus Bausteinen** (Überschrift, Absatz,
Tabellenzelle …). Der Editor verändert direkt diese Bausteine; Yjs schickt jede
kleine Änderung **sofort** an alle Mitarbeitenden. Weil man Bausteine (statt
Text) verschiebt, können mehrere gleichzeitig tippen, ohne sich zu überschreiben.
Die Markdown-Konvertierung läuft **genau 2× pro Sitzung** (rein/raus), nicht pro
Tastendruck.

### Speichern (raus)

```
ProseMirror-/Yjs-Knoten → TipTap generateHTML → HTML → turndown (+ turndown-plugin-gfm) → Repo-Markdown
```

### Plugins — bewusst minimal

Es gäbe ein fertiges Markdown-Plugin von TipTap selbst (`@tiptap/markdown`) —
das ist aber noch **early-release / nicht produktiv nutzbar** und würde die
verlustfreie Hin-und-Rück-Umwandlung nicht zuverlässig garantieren. Deshalb
zwei **ausgereifte Standardbibliotheken** (marked + turndown). Das **einzige**
eingesetzte Plugin ist **`turndown-plugin-gfm`** (Tabellen + Durchstreichung
beim Speichern).

Die Lücken zwischen der generischen Bibliotheks-Ausgabe und TipTaps spezifischem
Markup sind mit **eigenen Regeln** in [`src/markdown.js`](../src/markdown.js)
geschlossen — u. a. Übersetzung der Task-Listen in beide Richtungen, Entfernen
des `<colgroup>` (das sonst die GFM-Tabellenerkennung bricht), kompakte
Tabellenzellen/Listen, Sup/Sub als Inline-HTML. **Verlustfreiheit ist getestet**
([`test/roundtrip.test.mjs`](../test/roundtrip.test.mjs): jedes Konstrukt
überlebt, und eine zweite Runde ist identisch — `md2 === md3`).

> `markdown.js` läuft auf **Server UND Browser** (Node + Browser): der Server
> für Laden/Speichern, der Browser für das `markdown-change`-Event.

---

## 6. Architektur & Datenkommunikation

```
Angular / Host-Seite            (Session halten, Login, Statusanzeige)
   │  rein:  document-name, token, user-name
   │  raus:  markdown-change, save-state-change, users-change, …
   ▼
<md-collab-editor>              (Web Component — kennt edu-sharing NICHT)
   │  WebSocket /collab (Yjs)  +  Host spricht die REST-API
   ▼
Collab-Server                   (Express + Hocuspocus, EIN Prozess)
   │  validiert Token, lädt/speichert mit der User-Session
   ▼
edu-sharing Repository          (REST-API)
```

Der Server ist **ein einziger Node-Prozess** mit **zwei Kommunikationskanälen**:

### Kanal 1 — WebSocket auf `/collab` (Yjs, via Hocuspocus)

- **Binäre Yjs-Updates:** die eigentlichen Dokumentänderungen zwischen den Nutzern (Echtzeit).
- **Stateless-Nachrichten** (JSON über denselben Kanal): Kommandos & Status —
  `save` (Speichern-Button), `hello` (Client fragt Save-Zustand ab), sowie die
  Server-Broadcasts `config` / `saved` / `save-error` an **alle** Clients.
- **Dokumentname = Node-ID** (optional `<nodeId>:description`).

### Kanal 2 — HTTP-REST (Express)

| Route | Zweck |
|---|---|
| `GET /health` | Liveness-Probe (Docker-HEALTHCHECK) |
| `GET /api/config` | Repo-Basis-URL, ob Service-Account vorhanden |
| `POST /api/login` | Login (`{username,password}` oder `{ticket}`) → opakes Session-Token |
| `POST /api/logout` | Session serverseitig widerrufen |
| `GET /api/nodes/:id` | Knoten-Info + Save-Status (Auth-Passthrough) |
| `POST /api/nodes/:id/save` | sofort speichern (Login + Write-Recht nötig) |
| `POST /api/nodes/:id/autosave` | Auto-Speichern an/aus (dokumentweit) |

Der **Editor** spricht nur Kanal 1; die **Host-Seite** nutzt Kanal 2 für Login
und Statusanzeige. Beide teilen sich denselben Prozess und Speicher (Sessions,
offene Dokumente) — das ist Absicht (siehe [§13](#13-skalierung--produktivsetzung)).

---

## 7. Authentifizierung & Sessions

**Grundprinzip:** Credentials verlassen den Browser **nie**. Der Browser hält
nur ein **opakes, widerrufbares Session-Token**; die eigentlichen Zugangsdaten
(bzw. das edu-sharing-Ticket) leben ausschließlich im Server-Speicher.

### Ablauf

1. **Login** — `POST /api/login` mit `{username,password}` **oder** `{ticket}`.
   Der Server validiert gegen edu-sharing (`GET /iam/v1/people/-home-/-me-`).
2. **Session** — bei Erfolg erzeugt der Server ein **256-Bit-Zufallstoken**
   ([`server/sessions.js`](../server/sessions.js)) und legt intern den zugehörigen
   Auth-Header (`Basic …` bzw. `EDU-TICKET …`) ab (gleitende TTL, Default **8 h**).
   Nur das opake Token geht an den Client.
3. **Nutzung** — der Client übergibt das Token an die Komponente (Attribut
   `token`), diese reicht es über den WebSocket an den Server. `onAuthenticate`
   löst es via `resolveAuthToken` wieder zum echten Auth-Header auf und lädt/
   speichert damit im **Namen des Nutzers** (korrekter `cm:modifier` im Repo).
4. **Logout** — `POST /api/logout` widerruft die Session sofort **und schließt
   alle offenen Kollaborations-Verbindungen dieser Session** (auch zweite
   Tabs/Geräte verlieren Presence + Schreibrecht). Ein Reconnect mit dem
   widerrufenen Token wird abgelehnt — nur explizit anonymes Mitlesen bleibt
   möglich.

### Write-Gate (Autorisierung)

- Angemeldete Nutzer **ohne** Write-Recht auf dem Knoten werden **serverseitig
  auf read-only** geschaltet (`connectionConfig.readOnly` — von Hocuspocus
  durchgesetzt) — ihre Eingaben erreichen das gemeinsame Dokument gar nicht erst.
- Die HTTP-Mutations-Routen (`/save`, `/autosave`) verlangen Login **und**
  Write-Recht (sonst `401`/`403`).
- Repo-Writes laufen mit der Session eines **schreibberechtigten** Nutzers.

### Ticket-Auth für die Einbettung

Für den Einbettungsfall akzeptiert `POST /api/login` ein **edu-sharing-Ticket**
(`{ticket}`) statt Username/Passwort — die einbettende edu-sharing-Seite hat ja
bereits eine Session. Die Host-Seite nimmt dafür `?ticket=…` in der URL entgegen
und entfernt es sofort daraus.

> Verifikations-Stand: Der Ticket-Weg ist gegen einen Mock integrationsgetestet;
> die Verifikation mit einem echten Staging-Ticket steht noch aus (braucht die
> reale Einbettung).

---

## 8. edu-sharing-Anbindung (Speicherung in Metadaten)

**Datei-Content wird nie angefasst** — gespeichert wird in **Metadaten-Properties**.

| Ziel | Property | Endpunkt |
|---|---|---|
| **Standard** (Kompendialtext, auf `ccm:map` **und** `ccm:io`) | `ccm:oeh_collection_compendium_text` | `POST /property` (setProperty) |
| **Alternative** (`:description`) | `cm:description` + `cclom:general_description` | `PUT /metadata` |

### Lesen

```
GET /node/v1/nodes/-home-/{nodeId}/metadata?propertyFilter=-all-
→ node.properties["ccm:oeh_collection_compendium_text"][0]   (Properties sind IMMER Listen)
```

### Schreiben — **nicht** `PUT /metadata`, sondern `setProperty`

```
POST /node/v1/nodes/-home-/{nodeId}/property?property=ccm:oeh_collection_compendium_text
Body: ["<markdown>"]        ← JSON-Array, nicht String;  null = löschen
```

### Zwei verifizierte Fallen (Staging 07/2026)

Beide liefern **200 OK und speichern trotzdem nichts**:

1. **MDS-Filterung:** `PUT /metadata` filtert Properties gegen das Metadatenset
   (`mds_oeh`). `ccm:oeh_collection_compendium_text` ist dort **nicht definiert**
   → still verworfen. `POST /property` umgeht die Filterung.
2. **Fehlendes Write-Recht:** `PUT /metadata` verwirft auch ohne Schreibrecht still.

### Read-Back-Verifikation (Pflicht)

Weil einem `200` nicht zu trauen ist, liest der Server nach **jedem** Write den
Wert zurück und vergleicht — erst dann gilt es als gespeichert (grüne LED). Zusätzlich
vorab `node.access` auf `"Write"` prüfen. (Ausführlich im System-Skill
`wlo-edu-sharing-api` → „Properties schreiben — welcher Endpunkt?" und
„Kompendiale Texte".)

**Ausblick:** Sauberste Lösung mittelfristig — `ccm:oeh_collection_compendium_text`
regulär ins `mds_oeh` aufnehmen; dann funktioniert auch `PUT /metadata`, das Feld
wird in der edu-sharing-UI pflegbar, und der setProperty-Umweg entfällt.

---

## 9. Sync-Strategie & Timing

**Zwei Ebenen — strikt getrennt:**

1. **Echtzeit (Yjs):** Jeder Tastendruck geht **sofort** an alle Verbundenen.
   Dafür wird das Repo **nie** angefasst.
2. **Persistenz (edu-sharing):** Repo-Writes sind gebündelt, verifiziert und
   für alle sichtbar geregelt.

### Auslöser eines Repo-Writes

| Auslöser | Verhalten |
|---|---|
| Tippen (Auto-Speichern an) | frühestens **15 s** nach der letzten Eingabe; bei Dauertippen spätestens **alle 90 s** (`SAVE_DEBOUNCE_MS` / `SAVE_MAX_DEBOUNCE_MS`) |
| **Speichern-Button** | **sofort** — Kommando über den Kollaborationskanal; Ergebnis an alle |
| Auto-Speichern aus → an | aufgelaufener Puffer wird sofort nachgeholt |
| Letzter Nutzer trennt Verbindung | ausstehende Änderungen **sofort** gespeichert, Dokument entladen (nächster Öffner lädt frisch) |
| Write-Fehler | automatischer **Neuversuch nach 30 s** (`SAVE_RETRY_MS`) |
| Inhalt identisch zum letzten Save | **kein Write** (keine unnötigen Requests/Versionen) |

### Anzeige (Save-Bar, für alle synchron)

Countdown „speichert in 12s" (berechnet aus **eigenen und fremden** Änderungen),
danach grüne LED **erst nach Read-Back im Repo**. Status kommt als
Server-Broadcast — nicht per Polling.

---

## 10. Die Web Component & Angular-Einbettung

Der Editor ist ein **Custom Element** `<md-collab-editor>` — framework-agnostisch,
kennt edu-sharing nicht, spricht nur mit dem Collab-Server. Ein einzelnes Bundle
([`public/md-collab-editor.js`](../public/md-collab-editor.js)) + Styles aus
[`public/style.css`](../public/style.css) (Abschnitte `mce-*`/`tiptap`).

### Schnittstelle

**Attribute (rein):**

| Attribut | Pflicht | Bedeutung |
|---|---|---|
| `document-name` | ja | Yjs-Raum, i. d. R. die Node-ID; optional `:description` |
| `token` | nein | opakes Session-Token aus `POST /api/login`; ohne → read-only |
| `user-name` | nein | Anzeigename für Cursor/Presence |
| `user-color` | nein | Cursor-Farbe (Default: zufällig) |
| `websocket-url` | nein | Collab-Server (Default: `ws(s)://<host>/collab`) |
| `read-only` | nein | `"true"` erzwingt Nur-Lesen clientseitig |

**Events (raus, CustomEvent mit `detail`):**

| Event | detail | Zweck |
|---|---|---|
| `editor-ready` | `{editor}` | TipTap-Instanz verfügbar |
| `markdown-change` | `{markdown}` | aktueller Stand als Markdown (1 s debounced) |
| `status-change` | `{status}` | `connecting`/`connected`/`disconnected`/`session-expired` |
| `users-change` | `{users:[{name,color,isSelf,active}]}` | Presence inkl. „tippt gerade" |
| `save-state-change` | `{dirty,saving,lastSavedAt,…}` | Speicherzustand (Server-Broadcast) |
| `synced` | `{}` | initiale Synchronisation fertig |

**Methoden:** `getMarkdown(): string`, `focus()`.

### Einbettung in Angular

```ts
// app.module.ts (oder Standalone-Komponente)
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core'
@NgModule({ schemas: [CUSTOM_ELEMENTS_SCHEMA] })
// index.html / angular.json: md-collab-editor.js + style.css laden
```

```html
<md-collab-editor
  [attr.document-name]="nodeId"
  [attr.token]="sessionToken"
  [attr.user-name]="displayName"
  websocket-url="wss://collab.example.org/collab"
  (markdown-change)="onMarkdown($event.detail.markdown)"
  (save-state-change)="onSaveState($event.detail)">
</md-collab-editor>
```

Die **Session/Auth bleibt bei der Angular-Seite** (dem Host): sie holt das Token
(per Login oder edu-sharing-Ticket) und reicht es als `token` hinein. Bei
Einbettung aus einer **anderen Origin** als dem Collab-Server: Server-URL in
[`public/app-config.js`](../public/app-config.js) (`backendBase`) setzen und die
Origin am Server per `ALLOWED_ORIGINS` erlauben.

Die Demo-Host-Seite [`src/host.js`](../src/host.js) nutzt die Komponente **exakt
über diese Schnittstelle** und ist damit die **Referenzimplementierung** für die
Angular-Integration.

---

## 11. Was hinzugefügt wurde

Weil TipTap headless ist, sind alle sichtbaren UI-Elemente Eigenbau:

- **Toolbar mit Symbol-Buttons** — Fett/Kursiv/Durchgestrichen, Inline-Code,
  Hoch-/Tiefstellung, Überschriften H1–H3, Listen, **Task-Listen (☑)**, Zitat,
  Code-Block, Trennlinie, Link, Bild, **Tabelle** (mit Kontextaktionen +Zeile/
  +Spalte/−Zeile/−Spalte, die nur in Tabellen erscheinen), Undo/Redo. Mit
  WAI-ARIA-Toolbar-Muster (Roving-Tabindex, Pfeiltastennavigation).
- **Presence-Chips** rechts in der Toolbar — wer ist verbunden, wer tippt gerade
  (pulsierender Chip mit ✎), eigener Chip mit „(du)".
- **Save-Bar** — LED (grün = verifiziert gespeichert, gelb = Puffer mit
  Countdown, rot = Fehler, orange = Auto-Speichern aus, grau = keine
  Schreib-Session), Countdown-Text, **Speichern-Button**.
- **Test-/Referenz-API-Anbindung (Host-Seite):** Login (Benutzer/Passwort),
  Inhaltswahl (Node-ID + Speicherziel), Statusanzeige und Auto-Speichern-
  Schalter — als lauffähiges Beispiel, wie die spätere Angular-Seite die
  Komponente ansteuert und die REST-API nutzt.

---

## 12. Sicherheit

Der Stand ist zwei Audits durchlaufen ([`docs/audits/`](audits/)); die dort
gefundenen Punkte sind behoben. Die wichtigsten Sicherheitsmerkmale:

- **Keine Credentials im Browser** — nur opake, widerrufbare Session-Tokens
  (8 h gleitende TTL). Zugangsdaten/Tickets bleiben im Server-Speicher.
- **Login-Rate-Limit** pro Client-IP (`LOGIN_RATE_MAX`/`_WINDOW_MS`). Hinter
  einem Proxy **`TRUST_PROXY_HOPS`** korrekt setzen (nicht „trust all"), sonst
  ist die IP fälschbar und das Limit umgehbar.
- **WebSocket-Origin-Check** (CORS greift für WS nicht) — Cross-Site-Verbindungen
  werden abgewiesen (`ALLOWED_ORIGINS`).
- **Node-ID-Validierung** (UUID/Symbolkonstante) **vor** jeder REST-URL —
  verhindert Parameter-/Pfad-Injektion über frei wählbare Yjs-Raumnamen.
- **Security-Header** — `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  **CSP `frame-ancestors`** aus der Origin-Allowlist (bewusst **kein**
  `X-Frame-Options: DENY`, damit die edu-sharing-Einbettung möglich bleibt).
- **Read-only-Durchsetzung** für angemeldete Nutzer ohne Write-Recht (serverseitig).
- **Stored-XSS abgewehrt:** Beim Laden verwirft das restriktive TipTap-Schema
  (`generateJSON`) schemafremde HTML/Skripte; der Editor rendert via ProseMirror,
  nicht per `innerHTML` mit Fremddaten.
- **Read-Back-Verifikation** nach jedem Repo-Write (kein Vertrauen in `200`).
- **edu-sharing-Timeout** (`AbortSignal.timeout`) — ein hängender Repo-Call
  blockiert nicht.
- **Container-Härtung:** `.env` doppelt ausgeschlossen (`.dockerignore` +
  selektives COPY), `USER node` (non-root), HEALTHCHECK; anonymes Editieren im
  Container standardmäßig **aus** (`ALLOW_ANONYMOUS_EDIT` nur lokal).

---

## 13. Skalierung & Produktivsetzung

### Aktueller Stand (bewusste Grenzen)

- **Ein Prozess, Zustand im RAM:** offene Yjs-Dokumente, Sessions, Save-Puffer
  liegen im Speicher **eines** Node-Prozesses. Quelle der Wahrheit ist das Repo.
- Läuft nur in einer Umgebung mit **persistenten WebSockets** — reine
  Serverless-Plattformen (z. B. Vercel Functions) scheiden aus. Docker mit
  WebSocket-Support (Render, Railway, Fly.io, eigener Server). Details:
  [`README.md`](../README.md) → „Hosting".

### Skalierungs-Pfad (für Produktion)

- **RAM-unabhängige Yjs-Persistenz:** `@hocuspocus/extension-database` (z. B.
  Yjs-Updates in SQLite/Postgres) — überlebt Server-Neustarts während laufender
  Sitzungen.
- **Multi-Instanz:** `@hocuspocus/extension-redis` verteilt Yjs-Updates über
  mehrere Server-Instanzen; parallel den **Session-Store** nach Redis
  externalisieren (statt der In-Memory-Map in `server/sessions.js`).
- **Repo-Last bleibt niedrig** unabhängig von der Nutzerzahl — Debounce +
  Änderungserkennung bündeln Writes; der Status läuft per Broadcast, nicht per
  Polling.
- **Reverse-Proxy** (nginx/Caddy) für TLS-Terminierung — Kollaboration braucht
  `wss://`. Beispiele in [`README.md`](../README.md).

---

## 14. Semantisches Tagging (umgesetzt)

> **Status: umgesetzt** — nicht als Hashtag-Ansatz (früheres Konzept dieses
> Abschnitts), sondern als **Standoff-Annotationen**: Tags leben *neben* dem
> Text, der Markdown bleibt frei von Markierungszeichen. Vollständige
> Design-Begründung: **[SEMANTISCHES-TAGGING.md](SEMANTISCHES-TAGGING.md)**.

Kurzfassung der Prinzipien (Details und Trade-off-Tabellen im verlinkten Dokument):

- **Standoff statt Inline-Markup** — Annotationen `{id, quote, occurrence,
  type, entityId?}` in einer `Y.Array('annotations')` im selben Yjs-Dokument;
  Anzeige über ProseMirror-**Decorations** (View-Schicht, nicht Dokument).
  Der Markdown-Roundtrip bleibt unberührt verlustfrei.
- **Zitat-Anker statt Offsets** — „Offsets für den Code, Zitate für die KI":
  Positionen werden deterministisch per String-Suche aufgelöst; KI-Ausgaben
  (Zitat + Typ) sind direkt verwertbar, halluzinierte Zitate fallen durch.
- **Überlappung** — verschachtelt/deckungsgleich erlaubt, kreuzend abgelehnt.
- **Persistenz** — als General Keywords `Name (Typ)` in
  `cclom:general_keyword` via setProperty + Read-Back. **`Name (Typ)`-Keywords
  sind semantische Aussagen über die Texte des Knotens**: Beim Speichern
  werden nur Entitäten geschrieben, deren Zitat in der Textbasis verankert ist
  (Text dieses Dokuments **oder** das andere Feld — Kompendium und
  Beschreibung teilen **ein** Keyword-Feld). Nirgends verankerte Entitäten
  werden beim Speichern **automatisch entfernt** (Keyword + Pille;
  server-seitiger Prune nach verifiziertem Save mit Live-Text-Recheck,
  Snapshot-Refresh gegen Wiederauferstehung). Schlichte Keywords ohne Muster
  (`preservedKeywords`) sind redaktionell: eingelesen, in der Leiste gesperrt
  (🔒) angezeigt, byte-genau unverändert zurückgeschrieben; geschrieben wird
  dedupliziert (`serializeEntityKeywords`/`mergeKeywords` in
  `src/annotations.js`).
- **Typ-Katalog** — zwei Ebenen (Didaktik/Wissensart + Entitätstypen,
  `src/entity-types.js`), freie Typen erlaubt (nur Klammern verboten).

Weiterhin gültige Ausbaustufe aus dem ursprünglichen Konzept: **Vorschläge aus
bestehenden Repo-Keywords** über die NGSearch-Facetten-Aggregation auf
`cclom:general_keyword` (`POST /search/v1/…/ngsearch` mit
`facets:[{property:"cclom:general_keyword"}]`) hinter einer schlanken
Proxy-Route — sinnvoll gegen Tag-Fragmentierung, derzeit nicht angebunden.

---

## 15. Projektstruktur (Referenzdateien)

```
server.js                  Einstieg: Express-Routen + HTTP/WS-Bootstrap (crossws)
server/config.js           Konfiguration (Env)
server/edu-sharing-api.js  REST-Client: Login, Knoten, Laden/Speichern, setProperty, Read-Back
server/collab.js           Hocuspocus, Puffer-Strategie, Persistenz, Status-Broadcast
server/guards.js           Rate-Limiter, WebSocket-Origin-Check, Node-ID-Validierung
server/sessions.js         Server-seitiger Session-Store (opake Tokens, TTL, Ticket)
server/ai-tagging.js       KI-Verschlagwortung (B-API-Call, Validierung, Presence; gekapselt)
src/md-collab-editor.js    Web Component (Editor, Toolbar, Presence, Save-Bar)
src/role-block.js          TipTap-Node für Absatzrollen (:::-Container)
src/presence.js            Presence-Tracker (Awareness → Chips)
src/toolbar.js             Toolbar-Definition (Symbol-Buttons + Tabellen-Aktionen)
src/save-state.js          Save-Bar-Logik (pur, getestet)
src/save-bar.js            Save-Bar-Controller (DOM, Server-Events, Ticker)
src/annotations.js         Semantisches Tagging — pure Logik (pur, getestet)
src/entity-types.js        Default-Typkatalog (2 Ebenen, pur, getestet)
src/annotation-extension.js Decorations + Text-Index (Offset ⇄ PM-Position)
src/annotation-ui.js       Tag-Dialoge + Entitäten-Leiste (reines DOM)
src/annotation-controller.js Feature-Controller (Y.Array, Validierung, Orchestrierung)
src/extensions.js          TipTap-Extension-Set (Server + Client identisch)
src/markdown.js            Markdown ⇄ HTML (Server + Client identisch)
src/i18n.js                UI-Sprachen (de/en; gespeicherte Werte bleiben deutsch)
src/host.js                Demo-Host-Seite (Referenz für die Angular-Einbettung)
public/app-config.js       Laufzeit-Konfiguration (Backend-URL bei Cross-Origin)
public/                    HTML, CSS, gebaute Bundles
test/                      Testsuiten (npm test)
.github/ + .gitlab-ci.yml  CI: Build+Test, Docker-Image → ghcr.io / self-hosted
Dockerfile · docker-compose.yml   All-in-One-Container
docs/SEMANTISCHES-TAGGING.md      Design-Doku des semantischen Taggings
docs/audits/               Zwei Code-Audits (Findings behoben)
```

### Schnellstart für Entwickler

```bash
npm install
npm run dev     # baut beide Bundles + startet http://localhost:3000
npm test        # alle Suiten (Liste = package.json "test"): Roundtrip, Annotationen, Typkatalog, Save-Bar, Guards, Sessions, API-Auth, i18n, Annotations-UI, Yjs-Reconnect, Keyword-Lifecycle, KI-Tagging (gestubbtes Modell)
npm run lint    # ESLint über die gesamte Codebasis
```

---

*Eigener Code: MIT. Abhängigkeiten: siehe [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).
Fragen zum edu-sharing-API-Verhalten (setProperty, MDS-Silent-Drop, Read-Back):
System-Skill `wlo-edu-sharing-api`.*
