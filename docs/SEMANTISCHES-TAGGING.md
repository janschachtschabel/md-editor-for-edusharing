# Semantisches Tagging — Konzept & Umsetzung

Dieses Dokument beschreibt, **wie** das semantische Tagging im kollaborativen
Markdown-Editor umgesetzt ist und **warum** die zentralen Design-Entscheidungen
so gefallen sind. Zielgruppe: Entwickler:innen, die das Feature erweitern oder
in andere Kontexte übertragen wollen.

## Zwei Systeme — nach Semantik getrennt

Es gibt **zwei** Auszeichnungssysteme, weil zwei semantisch verschiedene Dinge
markiert werden. Der Mechanismus folgt der Semantik:

| | **Entitäten** (inline) | **Absatzrollen** (block) |
|---|---|---|
| Beispiel | „Weimar" ist ein `Ort`, „huygenssches Prinzip" ein `Fachbegriff` | dieser Absatz ist eine `Einleitung` / `Definition` / `Aufgabe` |
| Aussage | Metadaten **über** eine Textstelle (Referenz) | **Struktur des** Textes (Rolle im Lehr-/Lerngefüge) |
| Granularität | Wortgruppe (Span) | ganzer Block (ein oder mehrere Absätze) |
| Speicherort | **neben** dem Text (Standoff) → `cclom:general_keyword` als `Name (Typ)` | **im** Text als `:::`-Container im Markdown |
| Findbarkeit als Schlagwort | **ja** | **nein — nie in den Keywords** |
| Modul | `annotations*.js`, `entity-types.js` | `role-block.js`, `markdown.js`, `entity-types.js` |

Die **gemeinsame Wurzel** ist der Vokabular-Katalog in
[src/entity-types.js](../src/entity-types.js): frühere „Ebene 1" (Didaktik/
Wissensart) sind heute die **Absatzrollen**, „Ebene 2" (Domänen-Entitäten) die
**Entitätstypen**. Beide teilen sich dieselben Anzeige-Labels und
EN-Übersetzungen — eine Wahrheit, keine Drift.

Die Prinzipien 1–6 unten beschreiben das **Entitäten-System**; der Abschnitt
[„Absatzrollen"](#absatzrollen-struktur-im-markdown) das zweite. Warum
Absatzrollen bewusst *nicht* Standoff sind (und Entitäten schon), steht
ausführlich in [ABSATZROLLEN.md](ABSATZROLLEN.md).

---

# Teil A — Entitäten (Standoff → Keywords)

## Ziel

Nutzer:innen (und KI-Agenten) markieren Entitäten im Fließtext und diese
Auszeichnungen werden mit dem Dokument gespeichert, kollaborativ synchronisiert
und als edu-sharing-Keywords persistiert. Drei Anforderungen bestimmen das Design:

- **A1 — Sauberer Text:** Der Markdown-Text bleibt frei von Markierungszeichen,
  damit er unverändert als KI-Datengrundlage taugt.
- **A2 — Maschinenlesbarkeit:** Tags sind strukturiert abfragbar
  (Zitat, Stelle, Typ) — für Export, Suche und KI-Verarbeitung.
- **A3 — Kollaborationsfestigkeit:** Tags überleben gleichzeitiges Editieren
  durch mehrere Nutzer:innen.

## Prinzip 1: Standoff statt Inline-Markup

**Entscheidung:** Entitäts-Annotationen leben *neben* dem Text (Standoff-Prinzip),
nicht *im* Text.

| | Inline-Markup (verworfen) | Standoff (gewählt) |
|---|---|---|
| Beispiel | `Die Stadt [Weimar]{typ=Ort} liegt …` bzw. ein TipTap-Mark im Schema | Text unverändert + separate Liste `{quote: "Weimar", type: "Ort"}` |
| Markdown-Roundtrip | Marker müssten durch Markdown ⇄ HTML ⇄ ProseMirror verlustfrei wandern → eigene Syntax, eigener Parser | unberührt — der Roundtrip bleibt exakt so verlustfrei wie ohne Tags |
| KI-Datengrundlage | Text ist mit Syntax verschmutzt | Text bleibt sauber (A1) |
| Überlappung | Marks können in ProseMirror nicht beliebig überlappen | beliebige Spans möglich, Regeln frei definierbar |
| Anzeige | vom Schema gerendert | **ProseMirror-Decorations** — reine View-Schicht, Dokument unverändert |

Konsequenz für die Anzeige: getaggte Stellen werden als *Decorations*
gerendert ([src/annotation-extension.js](../src/annotation-extension.js)).
Decorations sind Teil der View, nicht des Dokuments — sie erscheinen weder im
Yjs-Dokument noch im Markdown-Export.

> Wichtig für die Abgrenzung: Prinzip 1 gilt für **Entitäten**. Absatzrollen
> sind *Struktur* (wie Überschriften) und stehen deshalb bewusst **im** Markdown
> — kein Widerspruch, sondern die passende Wahl je Kategorie (siehe Teil B).

## Prinzip 2: Zitat-Anker statt Positions-Anker

**Entscheidung:** Ein Tag wird über **Zitat + n-tes Vorkommen** verankert
(`{quote: "Weimar", occurrence: 2}`), nicht über Zeichen-Offsets.
Offsets werden bei Bedarf deterministisch per String-Suche berechnet
(`findQuoteRange` in [src/annotations.js](../src/annotations.js)).

Merksatz: **„Offsets für den Code, Zitate für die KI."** Abgewogene
Alternativen:

| Ankermodell | Robustheit bei Edits | KI-tauglich | Persistierbar | Aufwand |
|---|---|---|---|---|
| Integer-Offsets (`start: 120, end: 126`) | ✗ — jede Einfügung davor verschiebt alles | ✗ — LLMs zählen Zeichen unzuverlässig | ✓ | gering |
| Yjs Relative Positions | ✓ — CRDT-stabil | ✗ — für KI opak | nur mit Yjs-State | hoch (y-prosemirror-Interna) |
| **Zitat + Vorkommen (gewählt)** | ✓ solange der Wortlaut existiert | ✓ — LLMs liefern exakte Zitate zuverlässig | ✓ als lesbares Keyword | gering |

Eigenschaften des gewählten Modells:

- **Deterministisch im Mehrbenutzerbetrieb:** Alle Clients teilen denselben
  Dokumenttext (Yjs) und lösen Zitate identisch auf — keine
  Positions-Synchronisation nötig.
- **Halluzinations-Prüfung gratis:** Liefert eine KI ein Zitat, das nicht im
  Text steht, findet die Suche nichts → Annotation wird abgelehnt
  (`addAnnotation` gibt eine Fehlermeldung zurück).
- **Verwaiste Tags:** Wird der Wortlaut aus dem Text gelöscht, ist das Tag
  nicht mehr auflösbar (`start/end = null`) und wird in der Entitäten-Leiste
  ausgegraut angezeigt. Beim nächsten Speichern wird es **automatisch
  entfernt**, sofern es nicht im anderen Feld des Knotens verankert ist
  (Details: Prinzip 5) — Rückgängig (↶) vor dem Speichern stellt die
  Verankerung wieder her.
- **Längen-/Blockgrenze:** Zitate sind auf `MAX_QUOTE_LENGTH` (200) begrenzt
  und dürfen **keinen Zeilenumbruch** enthalten (`isValidQuote`) — ein Span
  über Absatzgrenzen wäre im Keyword nicht stabil. Genau dafür gibt es die
  Absatzrollen (Teil B).
- Yjs Relative Positions bleiben als Ausbaustufe möglich (z. B. zusätzlich
  zum Zitat als Schnell-Anker), wurden aber bewusst nicht als primäres
  Modell gewählt.

## Prinzip 3: Überlappungsregeln — verschachtelt ja, kreuzend nein

Zwei Spans können vier Beziehungen haben. Erlaubt sind drei:

```
disjunkt        [Weimar] … [Erfurt]                    ✓ erlaubt
verschachtelt   [Universität [Weimar]]                 ✓ erlaubt (z. B. Organisation außen, Ort innen)
deckungsgleich  [Weimar] + [Weimar]                    ✓ erlaubt (z. B. Ort UND Fachbegriff)
kreuzend        [Universität [Weimar] ist] schön       ✗ abgelehnt
```

**Warum kreuzend verboten?** Kreuzende Grenzen kommen in unseren Lehrtexten
semantisch nicht vor und deuten fast immer auf einen Modellierungsfehler hin.
Das Verbot hält Anzeige (verschachtelte `<span>`-Decorations) und Export
einfach. Die Prüfung (`isCrossing`) läuft beim Anlegen — im Dialog wie im
programmatischen Pfad — mit verständlicher Fehlermeldung.

## Prinzip 4: Kollaboration über dasselbe Yjs-Dokument

Die Annotationen liegen in einer **`Y.Array('annotations')` im selben
Yjs-Dokument** wie der Text — nicht in einem zweiten Kanal:

- Text und Tags synchronisieren über **eine** WebSocket-Verbindung und sind
  nie gegeneinander versetzt.
- Der Server sieht beide beim Laden/Speichern zusammen
  ([server/collab.js](../server/collab.js)).
- Tag-Änderungen zählen wie Textänderungen für den Save-Countdown; die
  Hocuspocus-Debounce-Strategie greift unverändert.
- Read-only-Verbindungen können auch die Tags nicht verändern (derselbe
  Schreibschutz wie für den Text).

(Absatzrollen brauchen keinen eigenen Kanal — sie sind Teil des Dokuments
selbst und synchronisieren als normale Block-Knoten mit.)

## Prinzip 5: Persistenz als lesbare General Keywords

Entitäten werden als **`cclom:general_keyword`** in der Form
**`Name (Typ)`** gespeichert — z. B. `Weimar (Stadt)`,
`huygenssches Prinzip (Fachbegriff)`:

- **Lesbar** in jeder edu-sharing-Oberfläche, ohne Spezial-Renderer.
- **Rückparsbar** über das Muster `… (…)` am Ende (`parseKeyword`); der Name
  darf selbst Klammern enthalten („Willy Brandt (SPD)"), nur die *letzte*
  Klammergruppe zählt als Typ. Deshalb sind **Klammern in Typwerten
  verboten** (`isValidType`).
- **Roundtrip als semantische Aussage:** Beim Laden wird **jedes** Keyword im
  Muster `Name (Typ)` zur Annotation — mit Anker im aktuellen Text als normale
  Pille, ohne als **verwaiste (graue) Pille**. Beim Speichern gilt:
  `preservedKeywords (nur schlichte, redaktionelle Keywords — unangetastet,
  in der UI gesperrt 🔒 angezeigt)` **+** `Entitäten, deren Zitat in der
  TEXTBASIS verankert ist` (Text dieses Dokuments **oder** das andere Feld des
  Knotens — Kompendium und Beschreibung teilen **ein** Keyword-Feld; die
  Prüfung gegen beide Texte verhindert, dass das Speichern im einen Feld die
  Tags des anderen zerstört). **Nirgends verankerte Entitäten werden beim
  Speichern automatisch entfernt** — Keyword und Pille (server-seitiger
  Prune nach verifiziertem Save, Recheck gegen den Live-Text, damit ein
  Undo während des Speicherns die Pille rettet) — ein veraltetes Tag würde
  die semantische Aussage über den Text verfälschen. Der Reconnect-Snapshot
  wird nach dem Prune aufgefrischt (sonst würden entfernte Pillen beim
  nächsten Laden wiederauferstehen). Allgemeines Merge-Muster: System-Skill
  `wlo-edu-sharing-api` → „Keywords sicher schreiben".
- **Mengen-Vergleich:** Änderungserkennung und Read-Back vergleichen die
  Keyword-Liste als **Menge** (Reihenfolge egal) — sonst löst schon ein
  Umsortieren durch das Repo einen Phantom-Write aus.
- **Read-Back-Verifikation:** „gespeichert" gilt erst nach bestätigtem
  Rücklesen aus dem Repo (edu-sharing kann 200 OK liefern und still verwerfen).

Grenze dieses Formats: Keywords tragen nur Name + Typ. Die optionale
`entityId` (Verweis auf ein Normdaten-/edu-sharing-Objekt) lebt daher nur im
Yjs-Dokument; eine dauerhafte Persistenz (z. B. eigenes JSON-Property) ist
eine dokumentierte Ausbaustufe.

## Prinzip 6: Geteilter Katalog mit freier Erweiterung

Der Vokabular-Katalog ([src/entity-types.js](../src/entity-types.js)) versorgt
**beide** Systeme aus einer Quelle:

- **Entitätstypen** (`DEFAULT_TYPE_GROUPS`) — nach Domäne gruppiert
  (Personen/Orte, Curriculum, Unterricht, Wissenschaft, Zeit/Recht, KI-Tools,
  Support/Doku). Werden im **Tag-Dialog** als Vorschläge angeboten.
- **Absatzrollen** (`DEFAULT_BLOCK_ROLES`) — die didaktischen Rollen als
  `{slug, label}`. Werden im **Rollen-Select** der Toolbar angeboten (Teil B).

Freie Werte bleiben in beiden Systemen erlaubt (Eingabe/Select mit Vorschlägen,
kein festes Dropdown). Für Entitätstypen ist die einzige Regel: keine Klammern
(Prinzip 5); bereits verwendete freie Typen erscheinen als eigene
Vorschlagsgruppe zuerst. EN-Labels kommen für beide Systeme aus derselben
`TYPE_LABELS_EN` (`typeLabel`/`roleLabel`), gespeicherte Werte bleiben deutsch.
Namenskonvention: Slash-Paare auf den Primärbegriff reduziert
(„Fach / Fachgebiet" → `Fach`), Klammer-Zusätze umformuliert
(„Methode (wissenschaftlich)" → `Wissenschaftliche Methode`).

---

# Teil B — Absatzrollen (Struktur im Markdown)

**Entscheidung:** Didaktische Rollen eines Absatzes (`Einleitung`, `Definition`,
`Aufgabe`, `Merksatz` …) sind **Struktur** und stehen deshalb — anders als
Entitäten — **im** Markdown, als benannter Container:

```markdown
::: definition
Die **Kartoffel** (Solanum tuberosum) ist eine Nutzpflanze.
:::
```

Begründung (ausführlich in [ABSATZROLLEN.md](ABSATZROLLEN.md)): Rollen sind wie
Überschriften Teil der Textstruktur — die KI-Pipeline *profitiert* vom Marker im
Rohtext, es gibt keine Anker-Fragilität (die Rolle klebt am Block, egal wie der
Satz umformuliert wird), die Struktur reist beim Kopieren/Export/Versionieren
mit, und die Kollaboration kommt gratis (normaler Yjs-Block). Overlap — der
Hauptgrund für Standoff bei Entitäten — wird hier nicht gebraucht.

**Umsetzung:**

- **Schema:** TipTap-Node `roleBlock` ([src/role-block.js](../src/role-block.js)),
  `group: block, content: block+`, Attribut `role` (Slug). Rendert als
  `<section data-role="…">`, wandert damit durch Yjs und HTML⇄JSON.
- **Markdown-Roundtrip** ([src/markdown.js](../src/markdown.js)): ein
  marked-Block-Tokenizer erkennt `::: slug … :::` und parst den Inhalt als
  normales Markdown (verschachtelte Blöcke überleben); eine Turndown-Regel
  serialisiert `section[data-role]` zurück zum `:::`-Container. Verlustfreiheit
  ist in `test/roundtrip.test.mjs` abgesichert (inkl. Stabilität `md2 === md3`).
- **Slugs:** Der Slug (`::: loesung`) ist markdown-sicher (`roleSlug`,
  Umlaut-Transliteration); das Anzeige-Label (`Lösung`/`Solution`) kommt aus dem
  geteilten Katalog (`roleLabel`).
- **Bedienung:** Rollen-`<select>` in der Toolbar (bewusst ein Select — eine
  exklusive Wahl pro Block, im Gegensatz zum Multi-Toggle der Entitäten).
  Auswahl setzt/ändert die Rolle (`setRole`), „— keine Rolle —" entfernt sie
  (`unsetRole`). Der Select spiegelt die Rolle des aktuellen Blocks; freie
  Rollen aus externem Markdown werden dynamisch ergänzt. Zusätzlich zeigt eine
  **Rollen-Leiste** (amberfarbene Chips, getrennt von den blauen
  Entitäten-Chips) alle Absatzrollen des Dokuments — Klick springt zur Stelle,
  ✕ entfernt die Rolle, **„alle ✕"** (ab 2 Rollen, mit Rückfrage) entfernt
  sämtliche Rollen auf einmal (`unsetAllRoles`); die Entitäten-Leiste hat
  denselben Sammel-Button für alle Pillen (`clearAll`).
- **Granularität:** Ganzer Absatz (Cursor + Select) **oder** Teil-Auswahl: wird
  nur ein Satz(teil) markiert und eine Rolle gewählt, teilt der Editor den
  Absatz automatisch (`setRole` mit `split`+`findWrapping`) — der markierte Teil
  wird ein eigener Rollen-Block. In einem bereits getaggten Absatz **verschachtelt**
  er sich (z. B. `Merksatz` in `These`); die Nachbarsätze behalten ihre Rolle.
  Das ✕/`unsetRole` löst genau diesen Wrapper an Ort und Stelle auf (kein Un-Nesting).
- **Persistenz:** keine eigene — die Rolle steht im Markdown und landet damit
  automatisch im Compendium-Property. Rollen erreichen `cclom:general_keyword`
  **per Konstruktion nie**. Geschachtelte Rollen nutzen geschachtelte `:::`
  (fence-zählender Tokenizer in `markdown.js`; Turndown nistet rekursiv von selbst).

---

## Schnittstellen für KI-Integration

Die Web Component bietet den Tagging-Zyklus programmatisch an:

```js
const editor = document.querySelector('md-collab-editor')

// --- Entitäten -----------------------------------------------------------
// KI-Ausgabe eintragen (Zitat + Typ genügen):
const error = editor.addAnnotation({ quote: 'Weimar', type: 'Ort' })
// → null bei Erfolg; Fehlermeldung bei nicht auffindbarem Zitat (Halluzination),
//   Kreuzung mit bestehendem Tag oder blockübergreifendem/zu langem Zitat

// Strukturierter Export (A2):
editor.getAnnotations()
// → [{id, quote, occurrence, type, entityId, start, end}] — Offsets gegen
//   den Plain-Text des Editors, null bei verwaisten Tags

editor.addEventListener('annotations-change', (e) => e.detail.annotations)

// --- Absatzrollen --------------------------------------------------------
// Rollen sind Teil des Dokuments — von einer KI am einfachsten direkt im
// Markdown gesetzt (::: role … :::); interaktiv/programmatisch über die
// Editor-Befehle:
editor.editor.chain().focus().setRole('definition').run()
editor.editor.chain().focus().unsetRole().run()
// Auslesen: im exportierten Markdown (getMarkdown) als ::: slug erkennbar.
```

**Eingebaute KI-Verschlagwortung (🤖):** Beide Zyklen sind zusätzlich als
Server-Feature verdrahtet ([server/ai-tagging.js](../server/ai-tagging.js)):
Der 🤖-Button (sichtbar, wenn serverseitig `AI_API_KEY` konfiguriert ist)
schickt `{event:'ai-tag'}` über den Kollaborationskanal; der Server tritt als
Presence-Teilnehmer „🤖 KI-Tagger" bei, fragt die B-API (OpenAI-Passthrough,
Modell `AI_MODEL`) nach Entitäten + Rollen als **exakten Zitaten** — für
Entitäten die **kürzeste** Wortgruppe, die die Entität benennt (nur der Name,
keine umgebenden Wörter); für Rollen `quote` aus dem ersten und optional
`endQuote` aus dem letzten Absatz eines **mehrabsätzigen** Abschnitts (der
Server umhüllt dann den zusammenhängenden Bereich, stoppt aber an bestehenden
Rollen-Blöcken; unbekanntes `endQuote` fällt auf den Einzelblock zurück,
getestet) —, validiert sie mit exakt denselben Regeln wie menschliche Eingaben
(Zitat muss existieren, kein Kreuzen, keine Duplikate, Rollen nur aus dem
Katalog) und wendet sie auf
das geteilte Y.Doc an — Pillen, Decorations und `:::`-Blöcke aktualisieren sich
bei allen Clients über die normalen Sync-Wege. Status läuft als
`ai-status`-Broadcast (started/done/error mit Codes, clientseitig übersetzt);
der API-Key verlässt den Server nie; read-only-Verbindungen dürfen nicht
auslösen.

## Modul-Landkarte

| Modul | System | Verantwortung | getestet |
|---|---|---|---|
| [src/annotations.js](../src/annotations.js) | Entitäten | pure Logik: Keyword ⇄ Annotation (`consumed`/`preserved`/`merge`), Zitat → Offsets, Kreuzungscheck, Zitat-/Typ-Validierung | `test/annotations.test.mjs` |
| [src/entity-types.js](../src/entity-types.js) | beide | geteilter Katalog: Entitätstypen + Absatzrollen, `roleSlug`/`roleLabel`, Vorschlags-Builder | `test/entity-types.test.mjs` |
| [src/annotation-extension.js](../src/annotation-extension.js) | Entitäten | TipTap-Extension: Text-Index (Offset ⇄ ProseMirror-Position), Decorations, Klick-Handling | indirekt |
| [src/annotation-ui.js](../src/annotation-ui.js) | Entitäten | DOM-Bausteine: Tag-Dialog, Verwaltungs-Popup, Entitäten-Chips | `test/annotation-ui.test.mjs` (jsdom) |
| [src/annotation-controller.js](../src/annotation-controller.js) | Entitäten | Feature-Controller: Y.Array, Validierung, Dialog-Orchestrierung | indirekt |
| [src/role-block.js](../src/role-block.js) | Rollen | TipTap-Node `roleBlock` (`:::`-Container) + Befehle `setRole`/`unsetRole` | `test/roundtrip.test.mjs` |
| [src/markdown.js](../src/markdown.js) | Rollen | marked-Tokenizer + Turndown-Regel für den `:::`-Roundtrip | `test/roundtrip.test.mjs` |
| [src/role-ui.js](../src/role-ui.js) | Rollen | Rollen-Select (Toolbar) + Rollen-Chips-Leiste | `test/component.test.mjs` (jsdom) |
| [src/md-collab-editor.js](../src/md-collab-editor.js) | beide | Toolbar: Entitäts-Button (Dialog) + Rollen-Select; Verdrahtung | `test/component.test.mjs` (jsdom) |
| [server/ai-tagging.js](../server/ai-tagging.js) | beide | KI-Verschlagwortung: B-API-Call, Validierung, Anwendung auf Y.Array + Y.Doc, Presence, Status-Broadcasts | `test/ai-tagging.test.mjs` |
| [server/collab.js](../server/collab.js) | Entitäten | Seed beim Laden, Keyword-Ableitung + Read-Back beim Speichern; `ai-tag`-Kommando | `test/keyword-lifecycle.test.mjs`, `test/collab-load.test.mjs` |
| [server/edu-sharing-api.js](../server/edu-sharing-api.js) | Entitäten | `cclom:general_keyword` lesen/schreiben (setProperty) | indirekt |

Die pure Logik ist bewusst DOM-/Yjs-frei und läuft identisch in Node
(Server-Seed/-Persistenz) und Browser (Anzeige/Validierung) — eine
Implementierung, keine Drift. Der `roleBlock`-Node ist ebenfalls pur (kein DOM)
und deshalb Teil des geteilten Extension-Sets für Server und Browser.

## Bekannte Grenzen & Ausbaustufen

- **`entityId`-Persistenz** — aktuell nur im Yjs-Dokument (s. Prinzip 5).
- **Blockübergreifende Entitäten** — ein Entitäts-Span darf keine Absätze
  überspannen (Zitate mit Zeilenumbruch wären im Keyword-Roundtrip nicht
  stabil); für ganze Absätze sind die **Absatzrollen** da.
- **Rollen-Nesting-Tiefe** — Verschachtelung funktioniert (Sub-Markierung),
  ist aber didaktisch für 1–2 Ebenen gedacht; tiefe Schachtelung ist erlaubt,
  aber nicht sinnvoll begrenzt.
- **Rollen-Wrap ersetzt den Block (Yjs hat kein „Move")** — jedes Umhüllen
  (manuell wie KI) muss den Block klonen und ersetzen. Tastenanschläge, die
  **exakt im Ersetzungsmoment** für genau diesen Block unterwegs sind
  (Fenster ≈ eine Netzwerk-Roundtrip), gehen verloren — inhärente
  Yjs-Eigenschaft. Abmilderung beim KI-Tagging: Zitate werden unmittelbar vor
  dem Wrap gegen den **aktuellen** Stand aufgelöst (veraltete Vorschläge aus
  der Modell-Latenz werden übersprungen, getestet) und alle Wraps laufen in
  **einer** Transaktion (ein atomares Update statt N Fenster, getestet).
- **KI-Call ohne Auto-Retry (bewusst)** — der Lauf ist nutzergetriggert,
  Fehler kommen sofort als `ai-status`-Broadcast zurück; erneut klicken IST
  der Retry (im Gegensatz zur Repo-Persistenz mit ihrem 30-s-Retry).
- **Chip-Entfernen bei Block-erstes-Kind-ist-Rolle** — das ✕ löst den Wrapper
  an der Position des Chips auf; liegt am Blockanfang direkt ein verschachtelter
  Rollen-Block (kein führender Absatz), kann die Auflösung den inneren treffen —
  seltener Grenzfall.
- **Rollen-Label als Slug im Editor-Container** — der `::before`-Chip am Block
  zeigt den Slug (`definition`) capitalisiert; die Chip-Leiste oben zeigt das
  volle übersetzte Label. Voll übersetzter Container-Chip wäre eine NodeView-Ausbaustufe.
- **Rollen-Auswertung repo-weit** — Rollen sind im Markdown maschinenlesbar
  (`^::: (\w+)`); ein optionales Spiegel-Property für „welche Kompendien haben
  Aufgaben?" ist bewusst nicht Teil v1.
- **Vorkommen-Zählung Markdown vs. Editor-Text** — die Auflösung nutzt den
  Klartext des Editors, der Server sucht im Markdown; bei Zitaten, die in
  Markdown-Syntax vorkommen (sehr selten), kann sich die Vorkommens-Nummer
  unterscheiden.
- **Yjs Relative Positions** als sekundärer Anker für noch robustere
  Verankerung bei starkem Umformulieren.
- **Mehrfachvorkommen im Editor** — eine Entität ist genau eine Pille/ein
  Keyword (Anker = Zitat + `occurrence`), aber im Editor werden ALLE
  Vorkommen des Zitat-Wortlauts hervorgehoben (`findAllQuoteRanges` in
  `annotation-extension.js`). Zwei unterschiedlich getypte Tags mit
  identischem Wortlaut würden sich an denselben Stellen überlagern — ein
  bewusst nicht abgefangener Grenzfall.
- **Yjs-Zustands-Cache pro Prozesslaufzeit** — `server/collab.js` hält den
  zuletzt bekannten Yjs-Zustand jedes Dokuments (`docSnapshots`) über das
  Entladen (letzter Client trennt Verbindung) hinweg vor und stellt ihn beim
  nächsten Laden per `Y.applyUpdate` wieder her, statt aus dem Markdown einen
  neuen Y.Doc zu bauen. Grund: ein frisch gebauter Y.Doc ist strukturell ein
  anderes Dokument (Yjs identifiziert Einfügungen über `(clientID, clock)`,
  nicht über Inhalt) — traf ein noch „lebender" Client (kurzer
  WebSocket-Reconnect, kein Seitenneuladen) auf einen neu gebauten Server-Y.Doc,
  wurden Text UND Entitäten dupliziert. Der Cache überlebt keinen
  Server-Neustart (rein In-Memory) und wird verworfen, sobald sich das
  Markdown im Repository seit dem letzten Snapshot geändert hat (dann ist ein
  Neuaufbau sicher, weil kein lebender Client existiert, mit dem dupliziert
  werden könnte).
