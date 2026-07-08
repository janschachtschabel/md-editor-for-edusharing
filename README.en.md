# Collaborative Markdown Editor for edu-sharing

> 🇩🇪 Deutsche Version: [README.md](README.md)

Real-time collaborative editing of **compendium texts** stored on edu-sharing
nodes (WLO staging). The editor is packaged as a **web component** designed to
be embedded into the edu-sharing Angular UI — session handling and persistence
wiring stay with the host.

| Building block | Role | License |
|---|---|---|
| [TipTap](https://tiptap.dev) v3 | WYSIWYG editor (ProseMirror-based) | MIT |
| [Yjs](https://yjs.dev) | CRDT — conflict-free real-time sync | MIT |
| [Hocuspocus](https://tiptap.dev/hocuspocus) v4 | Yjs WebSocket backend with auth/persistence hooks | MIT |
| marked + turndown (+ GFM plugin) | Markdown ⇄ HTML | MIT |

All dependencies are permissively licensed (MIT/BSD/ISC, no copyleft) — see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

> 📘 **For developers productionizing/integrating the code:** the detailed
> [developer guide](docs/ENTWICKLERLEITFADEN.md) (German) covers stack rationale,
> reused vs. self-built, data flow, auth, security/scaling and Angular embedding;
> the semantic-tagging design rationale lives in
> [SEMANTISCHES-TAGGING.md](docs/SEMANTISCHES-TAGGING.md) (German).

## Reused off the shelf vs. built in this project

**Taken unchanged from the libraries (configuration only):**

| Building block | What it provides out of the box |
|---|---|
| TipTap StarterKit + extensions (Table, TaskList/-Item, Image, Sup/Sub, Placeholder) | the complete editing behavior: document schema, input rules, formatting commands |
| TipTap Collaboration + CollaborationCaret | binding the editor to Yjs + rendering remote carets/selections |
| Yjs | CRDT merging — conflict-free simultaneous typing without custom merge code |
| Hocuspocus server/provider/transformer | WebSocket sync + reconnect, document lifecycle (load/unload on last disconnect), the **debounce machinery** for store hooks, server-side read-only gate, stateless message channel, TipTap JSON ⇄ Yjs |
| marked / turndown (+ GFM plugin) | markdown parsing / HTML→markdown base |
| Express / crossws | HTTP routing / WebSocket upgrade |

**Built in this project:**

| Part | Why custom |
|---|---|
| [`<md-collab-editor>`](src/md-collab-editor.js) web component | TipTap is headless — toolbar (incl. keyboard navigation), presence chips and the save bar (LED + countdown + save button) don't exist there |
| Markdown rule set ([src/markdown.js](src/markdown.js)) | lossless round trip: task-list markup translation, table `colgroup` fix, tight lists, sup/sub as inline HTML, empty-cell handling — all covered by tests |
| edu-sharing binding ([server/edu-sharing-api.js](server/edu-sharing-api.js)) | storage targets, the `setProperty` detour (MDS quirk), access checks, **read-back verification** |
| Persistence control ([server/collab.js](server/collab.js)) | buffering strategy, change detection, error retry, save-state broadcast (details below) |
| Session & security layer ([sessions.js](server/sessions.js), [guards.js](server/guards.js)) | opaque login/ticket sessions, rate limit, WS origin check, node-ID validation |
| Host page, 6 test suites, CI (GitHub + GitLab), Docker | reference embedding + quality assurance |

## Architecture

```
Angular / host page             (holds the session, login, status display)
   │  in:   document-name, token, user-name
   │  out:  markdown-change, save-state-change, users-change, …
   ▼
<md-collab-editor>              (web component — knows NOTHING about edu-sharing)
   │  WebSocket /collab (Yjs)
   ▼
Collab server                   (Express + Hocuspocus, single process)
   │  validates the token, loads/saves with the user's session
   ▼
edu-sharing repository          (REST API, staging)
```

## Installation

Requirements: **Node.js ≥ 20** (tested with 22), npm.

```bash
git clone <repo> && cd md-editor-test   # or your project folder
npm install
npm run dev          # builds both bundles and starts http://localhost:3000
```

Optionally create a `.env` (template: [.env.example](.env.example)):

| Variable | Default | Meaning |
|---|---|---|
| `EDU_REPO_BASE_URL` | `https://repository.staging.openeduhub.net` | repository base (without `/edu-sharing`) |
| `EDU_USER` / `EDU_PASS` | – | optional service-account fallback for saving |
| `PORT` | `3000` | HTTP and WebSocket port |
| `SAVE_DEBOUNCE_MS` | `15000` | repo write at the earliest X ms after the last change |
| `SAVE_MAX_DEBOUNCE_MS` | `90000` | at the latest every X ms while typing continuously |
| `EDU_TIMEOUT_MS` | `15000` | timeout per edu-sharing REST call |
| `LOGIN_RATE_MAX` | `10` | max login attempts per IP within the window |
| `LOGIN_RATE_WINDOW_MS` | `300000` | window length for the login rate limit |
| `SESSION_TTL_MS` | `28800000` | sliding lifetime of server-side sessions (8 h) |
| `TRUST_PROXY_HOPS` | `0` | number of trusted reverse-proxy hops (1 behind nginx/Render) |
| `ALLOWED_ORIGINS` | – | CORS/WebSocket allowlist for cross-origin embedding (see "Hosting") |
| `ALLOW_ANONYMOUS_EDIT` | `false` | **local development only**: allow editing without login |

## Testing the demo (multiple users)

1. Open `http://localhost:3000` — log in on the left (WLO staging account),
   pick a node ID (prefilled: content "Kartoffel", `ccm:io`), set a display
   name, click "Dokument öffnen".
2. Open the same link (shown in the sidebar) in a **second browser/tab with a
   different name** → live cursors, presence chips and real-time sync are
   immediately visible.
3. The **save bar** on the right of the editor toolbar is synchronized for all
   users: LED (green = verified saved, yellow = buffered with countdown, red =
   error, grey = no write session), plus a "Speichern" button for immediate
   saving.
4. Saving requires the logged-in account to have **write permission** on the
   node — otherwise the session stays read-only (and says so honestly).

Automated tests: `npm test` — 7 suites: markdown round trip (incl.
tables/task lists), annotation logic (keyword roundtrip, quote search,
crossing rule), entity-type catalog, save-bar logic, security guards, session store, and an API
integration that runs the real server against a mocked repository.

## Embedding the web component

The component ships as a single bundle
([public/md-collab-editor.js](public/md-collab-editor.js)); styles live in
[public/style.css](public/style.css) (sections `mce-*` and `tiptap`). It knows
nothing about edu-sharing — it only talks to the collab server.

### Attributes (in)

| Attribute | Required | Meaning |
|---|---|---|
| `document-name` | yes | Yjs room, usually the node ID; optionally `:description` to target the description field |
| `websocket-url` | no | collab server (default: `ws(s)://<host>/collab`) |
| `user-name` | no | display name for cursor/presence |
| `user-color` | no | cursor color (default: random) |
| `token` | no | opaque session token from `POST /api/login`; missing (or invalid/expired) → read-only |
| `read-only` | no | `"true"` forces read-only on the client side |

### Events (out, CustomEvent with `detail`)

| Event | detail | Purpose |
|---|---|---|
| `editor-ready` | `{editor}` | TipTap instance available |
| `markdown-change` | `{markdown}` | current state as markdown (debounced 1 s) |
| `status-change` | `{status}` | `connecting` / `connected` / `disconnected` |
| `users-change` | `{users:[{name,color,isSelf,active}]}` | presence incl. "currently typing" |
| `save-state-change` | `{dirty, saving, lastSavedAt, …}` | save state (server broadcast) |
| `annotations-change` | `{annotations:[{id,quote,occurrence,type,entityId,start,end}]}` | semantic tags (standoff, offsets resolved against the current markdown) |
| `synced` | `{}` | initial synchronization finished |

Methods: `getMarkdown(): string`, `getAnnotations()`,
`addAnnotation({quote, type, entityId?, occurrence?})` (programmatic tagging,
e.g. for AI results — returns an error message or `null`), `focus()`.

### Example: plain HTML

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

### Example: Angular

```ts
// app.module.ts (or standalone component)
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core'
@NgModule({ schemas: [CUSTOM_ELEMENTS_SCHEMA] })
// load md-collab-editor.js + style.css via index.html or angular.json
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

The demo's host page ([src/host.js](src/host.js)) uses the component through
exactly this interface and serves as the reference implementation.

## Storage targets & edu-sharing specifics

File content is **never** touched — everything is stored in metadata:

| Target | Property | Endpoint |
|---|---|---|
| Default (`ccm:map` **and** `ccm:io`) | `ccm:oeh_collection_compendium_text` | `POST /property` (setProperty) |
| Alternative (`:description`) | `cm:description` + `cclom:general_description` | `PUT /metadata` |
| Entity tags | `cclom:general_keyword` (form `Name (Type)`) | `POST /property` (setProperty) |

### Semantic tagging (standoff annotations)

Entities in the text can be marked and semantically tagged — **without any
markup entering the markdown** (standoff principle: the text stays a clean AI
data source). The full design rationale (standoff vs. inline markup, quote
anchors vs. offsets/relative positions, overlap rules, keyword roundtrip) is
documented in [docs/SEMANTISCHES-TAGGING.md](docs/SEMANTISCHES-TAGGING.md). Select text → toolbar button "🏷 Entität" → assign a type,
optional entity ID. The type input suggests a **default catalog**
([src/entity-types.js](src/entity-types.js), two levels: didactic knowledge
kinds like `Definition`/`Merksatz` and entity types like `Person`/
`Fachbegriff`/`Tool`, grouped by domain) plus types already used in the
document — **free custom types stay allowed** (parentheses are rejected
because the type is persisted as "Name (Typ)"). Tagged spans are rendered
as pure decorations; clicking one shows/deletes its tags; an entity bar below
the toolbar lists all tags as chips. Data model: `{id, quote, occurrence,
type, entityId?}` in a dedicated `Y.Array` inside the same Yjs document
(collaboration-safe); spans are anchored by **quote + n-th occurrence** —
offsets are always derived by deterministic string search ("quotes are for
the AI, offsets are for the code"). Nested and identical spans are allowed,
crossing spans are rejected. On save, entities are written as general
keywords in the form **`Weimar (Stadt)`** (read-back verified); on load,
keywords matching that pattern are parsed, re-anchored via quote search and
displayed — plain keywords are preserved untouched.

Two quirks verified on staging shaped the design:

1. `PUT /metadata` **filters properties against the MDS** — the compendium
   property is not defined there and gets silently dropped (200 OK, nothing
   stored). The setProperty endpoint bypasses that filter.
2. `PUT /metadata` also returns **200 OK without write permission** and drops
   silently. Hence: explicit access check before writing plus a **read-back
   verification** after every write — "saved" always means "confirmed in the
   repository".

## Writing to the repository: timing & control

The system strictly separates two layers:

1. **Real time (Yjs):** every keystroke reaches all connected users
   immediately — the repository is **never** touched for that.
2. **Persistence (edu-sharing):** repo writes are batched, verified and
   visibly controlled for all users.

### Anatomy of a write

```
input → Yjs sync to everyone (instant)
      → document becomes "dirty", countdown starts
      → debouncer fires (see trigger table)
      → gates: autosave on? write session present? write permission?
      → change detection: identical to last saved state? → no write
      → write (setProperty or PUT /metadata)
      → read-back: re-read the value and compare
      → broadcast "saved"/"save-error" to ALL clients → LED/display updates
```

### Triggers — when does a write actually happen?

| Trigger | Behavior |
|---|---|
| Typing (autosave **on**) | at the earliest **15 s after the last input**; while typing continuously at the latest **every 90 s** (Hocuspocus debounce, configurable via `SAVE_DEBOUNCE_MS` / `SAVE_MAX_DEBOUNCE_MS`) |
| **"Speichern" button** (in the editor toolbar) | **immediately** — the click travels as a command over the collaboration channel; the result is visible to all users at once |
| Autosave switch **off → on** | the accumulated buffer is flushed immediately |
| Last user disconnects | pending changes are saved **immediately**, then the document is unloaded from RAM — the next opener is guaranteed to load the repo state |
| Write fails technically | automatic **retry after 30 s**; the error is shown to everyone |
| Content identical to last save | **no write** — no needless requests/versions (e.g. cursor moves or undone edits) |

### Autosave switch vs. save button

- The **switch** applies **per document** (one shared repo state → one shared
  setting); its state is broadcast to all clients. **Off** = changes live only
  in the Yjs buffer; the browser warns before leaving with unsaved changes;
  when the last user disconnects, nothing is written (off means off).
- The **button** always writes immediately — including with autosave off
  ("draft mode with manual commit").
- Both controls require **login + write permission** server-side (otherwise
  401/403); the host page's HTTP variants likewise.

### Who writes — and what ends up in the repo?

Writes use the **session of a logged-in user with write permission**
(`cm:modifier` in the repository therefore shows a real person, not a service
account). Logged-in users **without** write permission are switched to
read-only server-side — their input never reaches the shared document in the
first place. "Saved" (green LED) always means **confirmed in the repository
via read-back** — never just "the server said 200" (edu-sharing can answer 200
and silently drop, see quirks above).

### What users see (save bar in the toolbar)

| LED | Text | Meaning |
|---|---|---|
| 🟡 blinking | "speichert in 12s" | buffer active, countdown until the auto-write (computed from own **and** remote changes) |
| 🟡 blinking | "speichere …" | write in progress (after button click) |
| 🟢 | "gespeichert 14:23" | verified in the repository |
| 🟠 | "ungespeichert · Auto-Speichern aus" | draft mode |
| 🔴 blinking | "Speicherfehler" (tooltip: cause) | write failed, retry pending |
| ⚪ | "wird nicht gespeichert" | no write session (not logged in / no write permission) |

## Project layout

```
server.js                  entry point: Express routes + HTTP/WS bootstrap
server/config.js           configuration (env)
server/edu-sharing-api.js  REST client (login, nodes, load/save)
server/collab.js           Hocuspocus, buffering strategy, read-back verification
server/guards.js           rate limiter + WebSocket origin check
server/sessions.js         server-side session store (opaque tokens, TTL)
src/md-collab-editor.js    web component
src/toolbar.js             toolbar definition
src/save-state.js          save-bar logic (pure, unit-tested)
src/annotations.js         semantic tagging — pure logic (unit-tested)
src/entity-types.js        default entity-type catalog (unit-tested)
src/annotation-extension.js tag rendering as ProseMirror decorations
src/annotation-ui.js       tag dialogs + entity chips bar
src/annotation-controller.js annotation feature controller (Y.Array, validation, orchestration)
src/extensions.js          TipTap extension set (identical on server + client)
src/markdown.js            markdown ⇄ HTML (identical on server + client)
src/host.js                demo host page (reference for the Angular embedding)
public/app-config.js       runtime configuration (backend URL for cross-origin embedding)
public/                    HTML, CSS, built bundles
test/                      7 test suites (npm test)
.github/ + .gitlab-ci.yml  CI: build+test, Docker image → ghcr.io / self-hosted registry
```

## Hosting (Docker)

Frontend + collab server run **together in one container**. Any Docker
environment with WebSocket support works (Render, Railway, Fly.io, your own
server).

```bash
docker compose up --build          # uses .env from the project folder
# or manually:
docker build -t md-collab-demo .
docker run -p 3000:3000 md-collab-demo
```

Behind HTTPS the page automatically uses `wss://`. Configuration via
environment variables (see the table above or [docker-compose.yml](docker-compose.yml)).

### Why not Vercel (or serverless in general)?

The collab server is a **long-lived, stateful process with persistent
WebSockets** — the exact opposite of serverless functions:

- **Persistent WebSockets:** Yjs/Hocuspocus keeps one connection open per open
  document for the whole editing session. Vercel functions cannot host a
  WebSocket *server* (they live only for one request).
- **In-RAM state:** open Yjs documents, session tokens, save buffers and
  debounce timers live in the memory of **one** process. Serverless is
  stateless/ephemeral — all of that would be lost between invocations.

**Hybrid is possible:** the static frontend *can* live on Vercel, but the
collab server must run on Docker (Render etc.) — connect the frontend via
[public/app-config.js](public/app-config.js) → `backendBase` and set
`ALLOWED_ORIGINS` on the server (see "Cross-origin embedding" below). For a
demo that only adds complexity; the **all-in-one container** is the simplest
path.

**Behind a reverse proxy (nginx, Traefik, Render …):**

1. Set `TRUST_PROXY_HOPS=1` (otherwise the login rate limit keys on the proxy
   IP instead of the client IP).
2. The proxy must **forward WebSocket upgrades** — for nginx:
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
3. The container reports its state via `GET /health` (a Docker HEALTHCHECK is
   configured in the image).

**Cross-origin embedding (optional, for later):** if the component is embedded
from a different origin (e.g. directly inside an edu-sharing page while the
collab server runs separately), set the server URL in
[public/app-config.js](public/app-config.js) and allow that origin on the
server via `ALLOWED_ORIGINS`. In the standard setup (everything in one
container) neither is needed.

## Limitations (demo state)

- Yjs documents live in RAM; the repository is the source of truth. For
  production add `@hocuspocus/extension-database`.
- The browser only holds an opaque, revocable session token (8 h sliding TTL,
  logout revokes server-side); credentials/tickets stay in server memory.
- **Ticket login for embedding:** `POST /api/login {ticket}` exchanges an
  edu-sharing ticket for a session (`EDU-TICKET` header); the host page
  accepts `?ticket=…` in the URL and strips it immediately. The ticket path is
  integration-tested against a mock — verification with a real staging ticket
  is still pending (requires the actual embedding).
- Mid-term the compendium property should be added properly to `mds_oeh`
  (removing the setProperty detour and making the field visible in the
  edu-sharing UI).

## License

Own code: MIT. Dependencies: see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
