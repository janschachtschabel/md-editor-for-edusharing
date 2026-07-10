# Wissensgrundlage: Aktualisierung des Entwickler-Briefings (Stand 2026-07-10)

Grundlage zum Update der Präsentation „Entwickler-Briefing — Produktivsetzung &
Integration". Teil 1 listet **pro Folie**, was falsch/veraltet ist. Teil 2 und 3
liefern die **korrekten, ausführlichen Inhalte** zu den zwei angefragten
Schwerpunkten (Semantisches Tagging, edu-sharing-Anbindung). Teil 4 schlägt
neue Folien vor.

---

## Teil 1 — Richtigstellungen pro Folie

| Folie | Alt (falsch/veraltet) | Neu (korrekt, Stand 07/2026) |
|---|---|---|
| 2 Überblick | „Semantisches Tagging: Hashtags → cclom:general_keyword **(Bauplan)**" | **Umgesetzt** — aber als anderes Modell: Standoff-Entitäten + Absatzrollen + KI-Verschlagwortung (s. Teil 2). Hashtags wurden verworfen. |
| 4 Bausteine | „Express v4" | **Express v5** (migriert, integrationsgetestet). Ergänzen: **crossws** (WebSocket-Adapter für Hocuspocus v4, MIT). |
| 6 Verantwortungsteilung | Eigenentwicklungs-Liste endet bei guards.js | Neu dazu: `annotations.js` (pure Tagging-Logik), `entity-types.js` (Kataloge: 112 Rollen + Entitätstypen, de/en), `annotation-extension/-ui/-controller.js`, `role-block.js` (`:::`-Container-Node), `presence.js`, `i18n.js` (de/en), **`server/ai-tagging.js`** (KI-Verschlagwortung, gekapselt) |
| 8 Architektur | Stateless-Kommandos: save · hello · config · saved · save-error | Zusätzlich: **`ai-tag` · `ai-status`** (KI-Lauf) ; `config` trägt jetzt auch `aiAvailable` und `plainKeywords` (Redaktions-Schlagwörter für die 🔒-Anzeige) |
| 9 Auth | „Logout widerruft die Session sofort" | Verschärft: Logout widerruft **und schließt alle offenen Kollaborations-Verbindungen dieser Session** (auch zweite Tabs/Geräte verlieren Presence + Schreibrecht); präsentierte, aber ungültige/abgelaufene Tokens werden beim Connect **abgelehnt** (kein stilles Read-only-Downgrade mehr). Ticket-Auth-Stand unverändert: gegen Mock getestet, echtes Staging-Ticket offen. |
| 10 edu-sharing | nur Markdown-Property | Ergänzen: **Keyword-Schreiben** (`cclom:general_keyword`) mit Merge-Modell + Read-Back — s. Teil 3 |
| 13 UI-Eigenbau | Toolbar, Presence, Save-Bar, Test-API | Neu dazu: **Entitäten-Leiste** (blaue Pillen + „alle ✕"), **Rollen-Select (112 Rollen) + Rollen-Leiste** (amber Chips + „alle ✕"), **🔒-Redaktions-Chips** (violett), **🤖-KI-Button** mit Status, **UI zweisprachig de/en** |
| 14 Sicherheit | „Zwei Audits durchlaufen" | **Fünf Audits** (docs/audits/); neu: KI-Kommando serverseitig aufs Schreibrecht ge-gatet (getestet), Logout-Session-Kill, KI-Key nur serverseitig |
| 16 Tagging | Hashtag-Bauplan (Variante A/B, #klimawandel, Diff gegen lastSavedMarkdown) | **Komplett ersetzen** — s. Teil 2. Das Hashtag-Konzept wurde nie gebaut. |
| 17 Schnellstart | „6 Suiten" (Kommentare zudem verrutscht: npm run dev/test/lint-Beschriftungen vertauscht) | **13 Suiten, ~316 Checks** (Roundtrip inkl. `:::`-Nesting, Annotations, Typkatalog, Save-Bar, Guards, Sessions, API-Auth, i18n-Parität, Annotations-UI/jsdom, Web-Component-Harness/jsdom, Yjs-Reconnect, Keyword-Lifecycle, KI gegen gestubbtes Modell) |

**Neue Themen, die in der alten Präsentation komplett fehlen:** KI-Verschlagwortung,
Absatzrollen, Zweisprachigkeit, LTI-Integrationsplan (docs/LTI-INTEGRATION.md:
edu-sharing ist LTI-1.3-Platform, Editor würde EIN Mal dort als Tool registriert,
LMS-Anbindung kommt transitiv; ~1,5–2,5 Wochen), Deployment-Realität (läuft auf
Debian-VPS hinter Caddy, Docker all-in-one, `.env`-Konfiguration inkl. KI-Vars).

---

## Teil 2 — Semantisches Tagging: wie es WIRKLICH funktioniert

### 2.1 Zwei Systeme, nach Semantik getrennt (nicht eines, nicht Hashtags)

| | **Entitäten** (inline) | **Absatzrollen** (block) |
|---|---|---|
| Beispiel | „Weimar" ist ein `Ort`, „Anna Müller" eine `Person` | dieser Absatz ist eine `Einleitung` / `Definition` / `Merksatz` |
| Aussage | Metadaten **über** eine Textstelle | **Struktur des** Textes (didaktische Funktion) |
| Granularität | Wortgruppe (Span) | ein **oder mehrere** Absätze; Teil-Auswahl wird automatisch als eigener (ggf. verschachtelter) Block abgetrennt |
| Speicherort | **neben** dem Text (Standoff) → Keyword `Name (Typ)` in `cclom:general_keyword` | **im** Markdown als `::: slug`-Container |
| In den Schlagwörtern? | ja (Findbarkeit) | **nie** |
| Bedienung | Text markieren → „🏷 Entität" → Typ (Katalog + frei) | Cursor/Auswahl → `¶ Rolle`-Select (112 Rollen, de/en) |
| Anzeige | dezente Unterstreichung im Text + **blaue Pillen**-Leiste (Klick = hinspringen, ✕, „alle ✕") | Container-Kasten mit Label-Chip im Text + **amber Chips**-Leiste (✕, „alle ✕") |

### 2.2 Entitäten: Standoff mit Zitat-Ankern („Zitate für die KI, Offsets für den Code")

- Annotationen leben als `{quote, occurrence, type, entityId?}` in einer
  **Y.Array im selben Yjs-Dokument** wie der Text — kollaborationsfest, ein
  Sync-Kanal, Anzeige als ProseMirror-**Decorations** (der Markdown bleibt
  komplett frei von Markierungszeichen = saubere KI-Datengrundlage).
- Verankert wird über **exaktes Zitat + n-tes Vorkommen**, nie über Offsets —
  LLMs liefern Zitate zuverlässig, Zeichenzählen nicht. Halluzinierte Zitate
  fallen automatisch durch (nicht auffindbar → abgelehnt).
- Regeln: verschachtelt/deckungsgleich erlaubt, **kreuzend verboten**; Zitat
  max. 200 Zeichen, keine Absatzgrenze; Typen ohne Klammern.

### 2.3 Persistenz als lesbare Keywords — mit klarer Eigentums-Regel

Entitäten werden als **`Name (Typ)`** (z. B. `Weimar (Stadt)`) in
`cclom:general_keyword` geschrieben — lesbar in jeder edu-sharing-UI, rückparsbar
(letzte Klammergruppe = Typ). Die Regel, WEM ein Keyword „gehört":

- **`Name (Typ)`-Keywords sind semantische Aussagen über die Texte des Knotens**
  und vollständig editor-verwaltet: Beim Speichern werden nur Entitäten
  geschrieben, deren Zitat in der **Textbasis** verankert ist (Kompendium
  **oder** Beschreibung — beide Felder teilen sich EIN Keyword-Feld; die
  Prüfung gegen beide verhindert, dass das eine Feld die Tags des anderen
  zerstört). Verschwindet der Wortlaut aus dem Text, wird die Pille grau
  (verwaist) und beim nächsten Speichern **automatisch entfernt** — ein
  veraltetes Tag würde die Aussage verfälschen. Undo vor dem Speichern rettet sie.
- **Schlichte Schlagwörter ohne Muster sind redaktionell und unantastbar**:
  byte-genau eingelesen und zurückgeschrieben, in der Leiste als eigene violette
  🔒-Gruppe („Redaktion:") sichtbar — Transparenz statt stillem Durchreichen.
- Geschrieben wird **dedupliziert**, verglichen als **Menge** (Repo darf
  umsortieren), verifiziert per **Read-Back** (s. Teil 3).

> **Bekannte offene Grenze (Audit 2026-07-10, Fix geplant):** Die
> Server-Ankerprüfung läuft derzeit gegen den Markdown-QUELLTEXT, die Anzeige
> gegen den Plain-Text — Zitate über Formatierungsgrenzen (`**fett** kursiv`)
> oder mit Escape-Zeichen (`snake_case`) können dadurch beim Speichern
> fälschlich als unverankert gelten. Vor produktiver Tagging-Nutzung wird die
> Prüfung auf Plain-Text umgestellt.

### 2.4 Absatzrollen: Struktur IM Markdown (bewusst kein Standoff)

Didaktische Rollen sind Struktur wie Überschriften — sie stehen deshalb im Text:

```markdown
::: definition
Die **Kartoffel** (Solanum tuberosum) ist eine Nutzpflanze.
:::
```

- Syntax: `:::`-Container (De-facto-Standard: Pandoc fenced_divs,
  markdown-it-container, Docusaurus); degradiert in fremden Renderern harmlos.
- LLM-Pipelines **profitieren**: die didaktische Struktur steht maschinenlesbar
  direkt im Rohtext (`^::: (\w+)` greppbar).
- Verschachtelung möglich (Merksatz **in** einer Einleitung — Untermarkierung
  per Teil-Auswahl mit Auto-Split); Roundtrip inkl. Nesting testgesichert.
- Katalog: **112 Rollen** (Einleitung … Eselsbrücke, Klausurtipp, Zeitstrahl,
  „Interpretation der Ergebnisse", „Offene Frage"), Slugs umlaut-sicher
  (`loesung`), Labels de/en aus gemeinsamer Quelle mit den Entitätstypen; freie
  Rollen erlaubt.
- Keine eigene Persistenz nötig: Rolle steht im Markdown → landet automatisch
  im Compendium-Property. **Erreicht `cclom:general_keyword` nie.**

### 2.5 KI-Verschlagwortung (🤖) — neu, umgesetzt

- **Button „🤖 KI-Tagging"** (sichtbar, wenn serverseitig ein B-API-Key
  konfiguriert ist): Die KI tritt als sichtbarer Presence-Teilnehmer
  „🤖 KI-Tagger" bei, liest das Markdown, erkennt **Entitäten** (kürzest-
  mögliche exakte Zitate + Typ) und **Absatzrollen** (auch mehrabsätzig via
  `endQuote`), wendet beides aufs geteilte Dokument an — Pillen/`:::`-Blöcke
  aktualisieren bei allen Clients — und verlässt den Editor wieder.
- **Modell = untrusted input**: Vorschläge durchlaufen dieselbe Validierung wie
  Menschen-Eingaben (Zitat muss existieren = Halluzinations-Filter, kein
  Kreuzen, keine Duplikate) und **strenger** (Rollen nur aus dem Katalog).
- **Anbindung**: B-API-OpenAI-Passthrough (`b-api.<domain>/api/v1/llm/openai`,
  automatisch vom Repo-Host abgeleitet), Modell konfigurierbar
  (Default `gpt-5.4-mini`), Key **nur serverseitig** (Env `AI_API_KEY`), Clients
  reden nie mit dem Modell. Auslösen erfordert Schreibrecht (serverseitig
  erzwungen + getestet); ein Lauf pro Dokument (Busy-Lock); kein Auto-Retry
  (erneut klicken = Retry, sofortiges Fehler-Feedback).

---

## Teil 3 — edu-sharing-Anbindung: genau erklärt

### 3.1 Grundprinzip

Datei-Content wird **nie** angefasst — gespeichert wird in **Metadaten**:

| Inhalt | Property | Endpunkt |
|---|---|---|
| Kompendiumtext (Markdown) | `ccm:oeh_collection_compendium_text` (auf `ccm:map` UND `ccm:io`) | `POST …/property?property=…` (setProperty), Body = JSON-Array `["<markdown>"]`, `null` = löschen |
| Alternative: Beschreibung | `cm:description` **+** `cclom:general_description` (Doppel-Schreibung) | `PUT …/metadata` (Feld ist im MDS) |
| Entitäts-Keywords + Redaktions-Schlagwörter | `cclom:general_keyword` (EINE geteilte Liste) | setProperty (ersetzt die ganze Liste → vorher mergen!) |

Lesen: normales `GET /node/v1/nodes/-home-/{id}/metadata?propertyFilter=-all-`
(Properties sind **immer Listen**). Referenz-Knoten: Writes an `originalId`.

### 3.2 Die zwei verifizierten Fallen (Staging, 07/2026)

Beide liefern **200 OK und speichern trotzdem nichts**:
1. **MDS-Filterung:** `PUT /metadata` verwirft Properties, die nicht im
   Metadatenset (`mds_oeh`) definiert sind — das Compendium-Feld ist es nicht.
   `POST /property` (setProperty) umgeht die Filterung.
2. **Fehlendes Write-Recht:** `PUT /metadata` verwirft auch dann still.

**Konsequenz (Pflicht-Muster):** Vor dem Schreiben `node.access` auf `"Write"`
prüfen; nach **jedem** Write per Read-Back zurücklesen und vergleichen
(Markdown exakt, Keywords als Menge) — erst dann „gespeichert" (grüne LED).
Ausblick unverändert: Feld regulär ins `mds_oeh` aufnehmen.

### 3.3 Sync-Strategie (unverändert gültig, jetzt inkl. Keywords)

Zwei strikt getrennte Ebenen: **Yjs** synchronisiert jeden Tastendruck sofort
zwischen den Nutzern (Repo unberührt); **Repo-Writes** laufen gebündelt —
frühestens 15 s nach letzter Eingabe, spätestens alle 90 s, sofort per Button
oder beim letzten Disconnect, Retry nach 30 s, kein Write bei identischem
Stand (Markdown-Vergleich exakt, Keyword-Vergleich als Menge). Countdown und
LED sind für alle Clients synchron (Broadcast, kein Polling).

### 3.4 Auth gegen edu-sharing

Credentials verlassen den Browser nie: Login (`{username,password}` oder
`{ticket}`) → Server validiert gegen edu-sharing → Browser erhält nur ein
opakes 256-Bit-Token (8 h gleitend); der echte Auth-Header bleibt im
Server-RAM. Schreibrecht wird pro Knoten geprüft (Hocuspocus erzwingt
Read-only serverseitig). **Neu:** Logout widerruft die Session UND schließt
alle offenen Kollaborations-Verbindungen dieser Session; ungültige Tokens
werden beim Connect abgelehnt. Repo-Writes laufen unter der Identität eines
schreibberechtigten Nutzers (korrekter `cm:modifier`).

---

## Teil 4 — Vorschlag: geänderte/neue Folien

1. **Folie 16 ersetzen** durch 2–3 Folien „Semantisches Tagging (umgesetzt)":
   (a) Zwei-Systeme-Tabelle (2.1), (b) Entitäten→Keywords mit Eigentums-Regel +
   🔒-Redaktions-Schutz (2.3), (c) Absatzrollen mit `:::`-Beispiel (2.4).
2. **Neue Folie „KI-Verschlagwortung (🤖)"** (2.5) — Presence-Auftritt,
   Validierung als untrusted input, B-API/Env, Schreibrecht-Gate.
3. **Folie 10 erweitern** um die Keyword-Zeile der Tabelle (3.1) und den Satz
   „Read-Back gilt auch für Keywords (Mengen-Vergleich)".
4. **Folie 9**: Logout-Kasten aktualisieren („beendet die Sitzung überall").
5. **Neue Folie „Ausblick: LTI 1.3"**: edu-sharing ist LTI-Platform mit
   Editor-Anbindungs-Endpunkten (`/ltiplatform/v13/…`, verifiziert); Editor
   einmal dort registrieren → alle LMS transitiv; Identität nativ über
   Launch-JWT; Aufwand ~1,5–2,5 Wochen (docs/LTI-INTEGRATION.md).
6. **Folie 17**: 13 Suiten/~316 Checks; Deployment-Realität (Docker auf VPS
   hinter Caddy, `.env` inkl. `AI_API_KEY`); sieben Audits in docs/audits/.
7. Durchgängig: „Express v5", Erwähnung Zweisprachigkeit (de/en).
