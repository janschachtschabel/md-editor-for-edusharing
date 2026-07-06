# Kollaborativer Markdown-Editor für edu-sharing

> 🇬🇧 English version: [README.en.md](README.en.md)

Kollaborative Echtzeit-Bearbeitung **kompendialer Texte** auf edu-sharing-Knoten
(WLO-Staging). Der Editor ist als **Web Component** gekapselt und dafür gebaut,
in die edu-sharing-Angular-Oberfläche eingebettet zu werden — Session und
Persistenz-Anbindung bleiben beim Host.

| Baustein | Rolle | Lizenz |
|---|---|---|
| [TipTap](https://tiptap.dev) v3 | WYSIWYG-Editor (ProseMirror-basiert) | MIT |
| [Yjs](https://yjs.dev) | CRDT — konfliktfreie Echtzeit-Synchronisation | MIT |
| [Hocuspocus](https://tiptap.dev/hocuspocus) v4 | Yjs-WebSocket-Backend mit Auth-/Persistenz-Hooks | MIT |
| marked + turndown (+ GFM-Plugin) | Markdown ⇄ HTML | MIT |

Alle Abhängigkeiten sind permissiv lizenziert (MIT/BSD/ISC, kein Copyleft) —
siehe [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Fertig nachgenutzt vs. Eigenentwicklung

**Unverändert aus den Bibliotheken übernommen (nur konfiguriert):**

| Baustein | Was er fertig liefert |
|---|---|
| TipTap StarterKit + Extensions (Table, TaskList/-Item, Image, Sup/Sub, Placeholder) | das komplette Editier-Verhalten: Dokumentschema, Eingaberegeln, Formatier-Befehle |
| TipTap Collaboration + CollaborationCaret | Kopplung des Editors an Yjs + Anzeige fremder Cursor/Markierungen |
| Yjs | CRDT-Merging — konfliktfreies gleichzeitiges Tippen ohne eigenen Merge-Code |
| Hocuspocus Server/Provider/Transformer | WebSocket-Sync + Reconnect, Dokument-Lifecycle (Laden/Entladen beim letzten Disconnect), **Debounce-Mechanik** für Speicher-Hooks, serverseitiges Read-only-Gate, Stateless-Nachrichtenkanal, TipTap-JSON ⇄ Yjs |
| marked / turndown (+ GFM-Plugin) | Markdown-Parsing bzw. HTML→Markdown-Basis |
| Express / crossws | HTTP-Routing / WebSocket-Upgrade |

**Eigenentwicklung dieses Projekts:**

| Teil | Warum selbst gebaut |
|---|---|
| [`<md-collab-editor>`](src/md-collab-editor.js) Web Component | TipTap ist headless — Toolbar (inkl. Tastaturnavigation), Presence-Chips, Save-Bar (LED + Countdown + Speichern-Button) existieren dort nicht |
| Markdown-Regelwerk ([src/markdown.js](src/markdown.js)) | verlustfreier Roundtrip: Task-Listen-Markup-Übersetzung, Tabellen-`colgroup`-Fix, kompakte Listen, Sup/Sub als Inline-HTML, Leerzellen-Behandlung — alles per Test abgesichert |
| edu-sharing-Anbindung ([server/edu-sharing-api.js](server/edu-sharing-api.js)) | Speicherziele, `setProperty`-Umweg (MDS-Quirk), Access-Checks, **Read-Back-Verifikation** |
| Persistenz-Regelung ([server/collab.js](server/collab.js)) | Puffer-Strategie, Änderungserkennung, Fehler-Retry, Save-Status-Broadcast (Details unten) |
| Session- & Sicherheits-Schicht ([sessions.js](server/sessions.js), [guards.js](server/guards.js)) | opake Login-/Ticket-Sessions, Rate-Limit, WS-Origin-Check, Node-ID-Validierung |
| Host-Seite, 6 Testsuiten, CI (GitHub + GitLab), Docker | Referenz-Einbettung + Qualitätssicherung |

## Architektur

```
Angular / Host-Seite            (Session halten, Login, Statusanzeige)
   │  rein:  document-name, token, user-name
   │  raus:  markdown-change, save-state-change, users-change, …
   ▼
<md-collab-editor>              (Web Component — kennt edu-sharing NICHT)
   │  WebSocket /collab (Yjs)
   ▼
Collab-Server                   (Express + Hocuspocus, ein Prozess)
   │  validiert Token, lädt/speichert mit der User-Session
   ▼
edu-sharing Repository          (REST-API, Staging)
```

## Installation

Voraussetzungen: **Node.js ≥ 20** (getestet mit 22), npm.

```bash
git clone <repo> && cd md-editor-test   # bzw. Projektordner
npm install
npm run dev          # baut beide Bundles und startet http://localhost:3000
```

Optional `.env` anlegen (Vorlage: [.env.example](.env.example)):

| Variable | Default | Bedeutung |
|---|---|---|
| `EDU_REPO_BASE_URL` | `https://repository.staging.openeduhub.net` | Repo-Basis (ohne `/edu-sharing`) |
| `EDU_USER` / `EDU_PASS` | – | optionaler Service-Account-Fallback fürs Speichern |
| `PORT` | `3000` | HTTP- und WebSocket-Port |
| `SAVE_DEBOUNCE_MS` | `15000` | Repo-Write frühestens X ms nach der letzten Änderung |
| `SAVE_MAX_DEBOUNCE_MS` | `90000` | bei Dauertippen spätestens alle X ms |
| `EDU_TIMEOUT_MS` | `15000` | Timeout je edu-sharing-REST-Aufruf |
| `LOGIN_RATE_MAX` | `10` | max. Login-Versuche je IP im Fenster |
| `LOGIN_RATE_WINDOW_MS` | `300000` | Fensterlänge fürs Login-Rate-Limit |
| `SESSION_TTL_MS` | `28800000` | gleitende Lebensdauer der Server-Sessions (8 h) |
| `TRUST_PROXY_HOPS` | `0` | Anzahl vertrauter Reverse-Proxy-Hops (1 hinter nginx/Render) |
| `ALLOWED_ORIGINS` | – | CORS-/WebSocket-Allowlist für Cross-Origin-Einbettung (siehe „Hosting") |
| `ALLOW_ANONYMOUS_EDIT` | `false` | **nur lokal**: Editieren ohne Login erlauben |

## Demo testen (mehrere Benutzer)

1. `http://localhost:3000` öffnen — links anmelden (WLO-Staging-Account),
   Node-ID wählen (vorbelegt: Inhalt „Kartoffel", `ccm:io`), Anzeigename setzen,
   „Dokument öffnen".
2. Denselben Link (wird in der Sidebar angezeigt) in einem **zweiten
   Browser/Tab mit anderem Namen** öffnen → Live-Cursor, Presence-Chips und
   Echtzeit-Sync sind sofort sichtbar.
3. Die **Save-Bar** rechts in der Editor-Toolbar zeigt für alle Nutzer synchron:
   LED (grün = verifiziert gespeichert, gelb = Puffer mit Countdown, rot =
   Fehler, grau = keine Schreib-Session), „Speichern"-Button für sofortiges
   Schreiben.
4. Zum Speichern braucht der angemeldete Account **Write-Recht** auf dem
   Knoten — ohne bleibt die Sitzung Nur-Lesen (ehrlich angezeigt).

Automatisierte Tests: `npm test` — 6 Suiten: Markdown-Roundtrip (inkl.
Tabellen/Task-Listen), Save-Bar-Logik, Security-Guards, Session-Store und eine
API-Integration, die den echten Server gegen ein Mock-Repo fährt.

## Web Component einbinden

Die Komponente ist ein einzelnes Bundle ([public/md-collab-editor.js](public/md-collab-editor.js)),
Styles liegen in [public/style.css](public/style.css) (Abschnitte `mce-*` und
`tiptap`). Sie kennt edu-sharing nicht — sie spricht nur mit dem Collab-Server.

### Attribute (rein)

| Attribut | Pflicht | Bedeutung |
|---|---|---|
| `document-name` | ja | Yjs-Raum, i. d. R. die Node-ID; optional `:description` für das Beschreibungsfeld |
| `websocket-url` | nein | Collab-Server (Default: `ws(s)://<host>/collab`) |
| `user-name` | nein | Anzeigename für Cursor/Presence |
| `user-color` | nein | Cursor-Farbe (Default: zufällig) |
| `token` | nein | opakes Session-Token aus `POST /api/login`; ohne (oder ungültig/abgelaufen) → read-only |
| `read-only` | nein | `"true"` erzwingt Nur-Lesen clientseitig |

### Events (raus, CustomEvent mit `detail`)

| Event | detail | Zweck |
|---|---|---|
| `editor-ready` | `{editor}` | TipTap-Instanz verfügbar |
| `markdown-change` | `{markdown}` | aktueller Stand als Markdown (1 s debounced) |
| `status-change` | `{status}` | `connecting` / `connected` / `disconnected` |
| `users-change` | `{users:[{name,color,isSelf,active}]}` | Presence inkl. „tippt gerade" |
| `save-state-change` | `{dirty, saving, lastSavedAt, …}` | Speicherzustand (Server-Broadcast) |
| `synced` | `{}` | initiale Synchronisation abgeschlossen |

Methoden: `getMarkdown(): string`, `focus()`.

### Beispiel: pures HTML

```html
<link rel="stylesheet" href="style.css" />
<script src="md-collab-editor.js"></script>

<md-collab-editor document-name="bd898a4c-311b-48d8-9a40-bea930811c8e"
                  user-name="Jan" token="…"></md-collab-editor>

<script>
  const el = document.querySelector('md-collab-editor')
  el.addEventListener('markdown-change', (e) => console.log(e.detail.markdown))
</script>
```

### Beispiel: Angular

```ts
// app.module.ts (bzw. Standalone-Komponente)
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core'
@NgModule({ schemas: [CUSTOM_ELEMENTS_SCHEMA] })
// index.html oder angular.json: md-collab-editor.js + style.css laden
```

```html
<md-collab-editor
  [attr.document-name]="nodeId"
  [attr.user-name]="displayName"
  [attr.token]="sessionToken"
  websocket-url="wss://collab.example.org/collab"
  (markdown-change)="onMarkdown($event.detail.markdown)"
  (save-state-change)="onSaveState($event.detail)">
</md-collab-editor>
```

Die Host-Seite dieser Demo ([src/host.js](src/host.js)) nutzt die Komponente
exakt über diese Schnittstelle und dient als Referenzimplementierung.

## Speicherziele & edu-sharing-Besonderheiten

Datei-Content wird **nie** angefasst — gespeichert wird in Metadaten:

| Ziel | Property | Endpunkt |
|---|---|---|
| Standard (`ccm:map` **und** `ccm:io`) | `ccm:oeh_collection_compendium_text` | `POST /property` (setProperty) |
| Alternative (`:description`) | `cm:description` + `cclom:general_description` | `PUT /metadata` |

Zwei auf der Staging verifizierte Quirks bestimmen das Design:

1. `PUT /metadata` **filtert Properties gegen das MDS** — das Kompendium-Property
   ist dort nicht definiert und wird still verworfen (200 OK, nichts
   gespeichert). Der setProperty-Endpunkt umgeht die Filterung.
2. `PUT /metadata` liefert auch **ohne Write-Recht 200 OK** und verwirft still.
   Daher: expliziter Access-Check vor dem Schreiben und
   **Read-Back-Verifikation** nach jedem Write — „gespeichert" heißt immer
   „im Repo bestätigt".

## Schreiben ins Repo: Timing & Regelung

Das System trennt zwei Ebenen strikt:

1. **Echtzeit (Yjs):** Jeder Tastendruck geht sofort an alle verbundenen
   Nutzer — dafür wird **nie** das Repo angefasst.
2. **Persistenz (edu-sharing):** Repo-Writes sind gebündelt, verifiziert und
   für alle Nutzer sichtbar geregelt.

### Ablauf eines Writes

```
Eingabe → Yjs-Sync an alle (sofort)
        → Dokument gilt als „dirty", Countdown startet
        → Debouncer feuert (s. Auslöser-Tabelle)
        → Gates: Auto-Speichern an? Schreib-Session vorhanden? Write-Recht?
        → Änderungserkennung: identisch zum letzten Stand? → kein Write
        → Write (setProperty bzw. PUT /metadata)
        → Read-Back: Wert zurücklesen und vergleichen
        → Broadcast „saved"/„save-error" an ALLE Clients → LED/Anzeige aktualisiert
```

### Auslöser — wann wird tatsächlich geschrieben?

| Auslöser | Verhalten |
|---|---|
| Tippen (Auto-Speichern **an**) | frühestens **15 s nach der letzten Eingabe**; bei Dauertippen spätestens **alle 90 s** (Hocuspocus-Debounce, konfigurierbar via `SAVE_DEBOUNCE_MS` / `SAVE_MAX_DEBOUNCE_MS`) |
| **„Speichern"-Button** (in der Editor-Toolbar) | **sofort** — der Klick geht als Kommando über den Kollaborationskanal an den Server; das Ergebnis sehen alle Nutzer gleichzeitig |
| Auto-Speichern-Schalter **aus → an** | aufgelaufener Puffer wird sofort nachgeholt |
| Letzter Nutzer trennt die Verbindung | ausstehende Änderungen werden **sofort** gespeichert, dann wird das Dokument aus dem RAM entladen — der nächste Öffner lädt garantiert den Repo-Stand |
| Write schlägt technisch fehl | automatischer **Neuversuch nach 30 s**; Fehler wird allen angezeigt |
| Inhalt identisch zum letzten Save | **kein Write** — keine unnötigen Requests/Versionen (z. B. bei Cursor-Bewegungen oder rückgängig gemachten Änderungen) |

### Auto-Speichern-Schalter vs. Speichern-Button

- Der **Schalter** gilt **dokumentweit** (ein gemeinsamer Repo-Stand → eine
  gemeinsame Einstellung); sein Zustand wird an alle Clients gebroadcastet.
  **Aus** = Änderungen bleiben nur im Yjs-Puffer; der Browser warnt beim
  Verlassen vor ungespeicherten Änderungen; beim Trennen des letzten Nutzers
  wird dann **nicht** geschrieben (aus heißt aus).
- Der **Button** schreibt immer sofort — auch bei ausgeschaltetem
  Auto-Speichern („Entwurfsmodus mit manuellem Commit").
- Beide Bedienelemente verlangen serverseitig **Login + Write-Recht**
  (sonst 401/403); die HTTP-Varianten der Host-Seite ebenso.

### Wer schreibt — und was steht im Repo?

Gespeichert wird mit der **Session eines angemeldeten, schreibberechtigten
Nutzers** (`cm:modifier` im Repo zeigt also eine echte Person, keinen
Service-Account). Angemeldete Nutzer **ohne** Write-Recht werden serverseitig
auf read-only geschaltet — ihre Eingaben erreichen das gemeinsame Dokument gar
nicht erst. „Gespeichert" (grüne LED) heißt immer **per Read-Back im Repo
bestätigt** — nie nur „der Server hat 200 gesagt" (edu-sharing kann 200 liefern
und still verwerfen, siehe Quirks oben).

### Sichtbarkeit für die Nutzer (Save-Bar in der Toolbar)

| LED | Text | Bedeutung |
|---|---|---|
| 🟡 blinkend | „speichert in 12s" | Puffer aktiv, Countdown bis zum Auto-Write (berechnet aus eigenen **und** fremden Änderungen) |
| 🟡 blinkend | „speichere …" | Write läuft (nach Button-Klick) |
| 🟢 | „gespeichert 14:23" | im Repo verifiziert |
| 🟠 | „ungespeichert · Auto-Speichern aus" | Entwurfsmodus |
| 🔴 blinkend | „Speicherfehler" (Tooltip: Ursache) | Write fehlgeschlagen, Retry läuft |
| ⚪ | „wird nicht gespeichert" | keine Schreib-Session (nicht angemeldet / kein Write-Recht) |

## Projektstruktur

```
server.js                  Einstieg: Express-Routen + HTTP/WS-Bootstrap
server/config.js           Konfiguration (Env)
server/edu-sharing-api.js  REST-Client (Login, Knoten, Laden/Speichern)
server/collab.js           Hocuspocus, Puffer-Strategie, Read-Back-Verifikation
server/guards.js           Rate-Limiter + WebSocket-Origin-Check
server/sessions.js         Server-seitiger Session-Store (opake Tokens, TTL)
src/md-collab-editor.js    Web Component
src/toolbar.js             Toolbar-Definition
src/save-state.js          Save-Bar-Logik (pur, getestet)
src/extensions.js          TipTap-Extension-Set (Server + Client identisch)
src/markdown.js            Markdown ⇄ HTML (Server + Client identisch)
src/host.js                Demo-Host-Seite (Referenz für die Angular-Einbettung)
public/app-config.js       Laufzeit-Konfiguration (Backend-URL bei Cross-Origin-Einbettung)
public/                    HTML, CSS, gebaute Bundles
test/                      6 Testsuiten (npm test)
.github/ + .gitlab-ci.yml  CI: Build+Test, Docker-Image → ghcr.io bzw. self-hosted Registry
```

## Hosting (Docker)

Frontend + Collab-Server laufen **zusammen in einem Container**. Der Server
braucht persistente WebSocket-Verbindungen (Yjs) — reine
Serverless-Plattformen (z. B. Vercel Functions) scheiden daher aus; geeignet
ist jede Docker-Umgebung mit WebSocket-Support (Render, Railway, Fly.io,
eigener Server).

```bash
docker compose up --build          # nutzt .env aus dem Projektordner
# oder manuell:
docker build -t md-collab-demo .
docker run -p 3000:3000 md-collab-demo
```

Hinter HTTPS nutzt die Seite automatisch `wss://`. Konfiguration über
Umgebungsvariablen (siehe Tabelle oben bzw. [docker-compose.yml](docker-compose.yml)).

**Hinter einem Reverse-Proxy (nginx, Traefik, Render …):**

1. `TRUST_PROXY_HOPS=1` setzen (sonst greift das Login-Rate-Limit auf die
   Proxy-IP statt auf die Client-IP).
2. Der Proxy muss **WebSocket-Upgrades durchreichen** — für nginx:
   ```nginx
   location / {
     proxy_pass http://md-collab:3000;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_set_header Host $host;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   ```
3. Der Container meldet seinen Zustand über `GET /health` (Docker-HEALTHCHECK
   ist im Image konfiguriert).

**Cross-Origin-Einbettung (optional, für später):** Wird die Komponente aus
einer anderen Origin eingebettet (z. B. direkt in einer edu-sharing-Seite,
während der Collab-Server separat läuft), die Server-URL in
[public/app-config.js](public/app-config.js) setzen und die Origin am Server
per `ALLOWED_ORIGINS` erlauben. Im Standard-Setup (alles ein Container) ist
beides nicht nötig.

## Grenzen (Demo-Stand)

- Yjs-Dokumente leben im RAM; Quelle der Wahrheit ist das Repo. Für Produktion:
  `@hocuspocus/extension-database`.
- Der Browser hält nur ein opakes, widerrufbares Session-Token (8 h gleitend,
  Logout revoked serverseitig); Credentials/Tickets bleiben im Server-RAM.
- **Ticket-Login für die Einbettung:** `POST /api/login {ticket}` tauscht ein
  edu-sharing-Ticket gegen eine Session (`EDU-TICKET`-Header); die Host-Seite
  akzeptiert dafür `?ticket=…` in der URL und entfernt es sofort daraus.
  Der Ticket-Weg ist gegen einen Mock integrationsgetestet — die Verifikation
  mit einem echten Staging-Ticket steht noch aus (braucht die Einbettung).
- Das Kompendium-Property sollte mittelfristig regulär ins `mds_oeh`
  aufgenommen werden (dann entfällt der setProperty-Umweg und das Feld wird in
  der edu-sharing-UI sichtbar).

## Lizenz

Eigener Code: MIT. Abhängigkeiten: siehe
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
