# Semantisches Tagging — Konzept & Umsetzung

Dieses Dokument beschreibt, **wie** das semantische Tagging im kollaborativen
Markdown-Editor umgesetzt ist und **warum** die zentralen Design-Entscheidungen
so gefallen sind. Zielgruppe: Entwickler:innen, die das Feature erweitern oder
in andere Kontexte übertragen wollen.

## Ziel

Nutzer:innen (und KI-Agenten) markieren Entitäten im Fließtext — „Weimar" ist
ein `Ort`, „huygenssches Prinzip" ein `Fachbegriff` — und diese Auszeichnungen
werden mit dem Dokument gespeichert, kollaborativ synchronisiert und als
edu-sharing-Keywords persistiert. Drei Anforderungen bestimmen das Design:

- **A1 — Sauberer Text:** Der Markdown-Text bleibt frei von Markierungszeichen,
  damit er unverändert als KI-Datengrundlage taugt.
- **A2 — Maschinenlesbarkeit:** Tags sind strukturiert abfragbar
  (Zitat, Stelle, Typ) — für Export, Suche und KI-Verarbeitung.
- **A3 — Kollaborationsfestigkeit:** Tags überleben gleichzeitiges Editieren
  durch mehrere Nutzer:innen.

## Prinzip 1: Standoff statt Inline-Markup

**Entscheidung:** Annotationen leben *neben* dem Text (Standoff-Prinzip),
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
  nicht mehr auflösbar (`start/end = null`). Es wird in der Entitäten-Leiste
  ausgegraut angezeigt und bleibt als Keyword erhalten, bis es explizit
  entfernt wird — kein stilles Verschwinden.
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

## Prinzip 5: Persistenz als lesbare General Keywords

Entitäten werden als **`cclom:general_keyword`** in der Form
**`Name (Typ)`** gespeichert — z. B. `Weimar (Stadt)`,
`huygenssches Prinzip (Fachbegriff)`:

- **Lesbar** in jeder edu-sharing-Oberfläche, ohne Spezial-Renderer.
- **Rückparsbar** über das Muster `… (…)` am Ende (`parseKeyword`); der Name
  darf selbst Klammern enthalten („Willy Brandt (SPD)"), nur die *letzte*
  Klammergruppe zählt als Typ. Deshalb sind **Klammern in Typwerten
  verboten** (`isValidType`).
- **Roundtrip:** Beim Laden werden Keywords im Muster geparst, per
  Zitat-Suche im Text verankert und als Annotationen gesetzt; nicht (mehr)
  auffindbare Zitate werden übersprungen. Beim Speichern werden Keywords aus
  den Annotationen neu aufgebaut und dedupliziert. **Keywords ohne Muster
  („Optik") bleiben unangetastet erhalten.**
- **Read-Back-Verifikation:** Wie beim Markdown gilt „gespeichert" erst nach
  bestätigtem Rücklesen aus dem Repo (edu-sharing kann 200 OK liefern und
  still verwerfen).

Grenze dieses Formats: Keywords tragen nur Name + Typ. Die optionale
`entityId` (Verweis auf ein Normdaten-/edu-sharing-Objekt) lebt daher nur im
Yjs-Dokument; eine dauerhafte Persistenz (z. B. eigenes JSON-Property) ist
eine dokumentierte Ausbaustufe.

## Prinzip 6: Typ-Katalog mit freier Erweiterung

Der Tag-Dialog schlägt einen **Default-Katalog** vor
([src/entity-types.js](../src/entity-types.js)), zwei Ebenen:

1. **Didaktik / Wissensart** — Rolle im Lehr-/Lerngefüge
   (`Definition`, `Beispiel`, `Aufgabe`, `Merksatz`, …).
2. **Entitätstypen** nach Domäne gruppiert — Personen/Orte, Curriculum,
   Unterricht, Wissenschaft, Zeit/Recht, KI-Tools, Support/Doku.

Freie Typen bleiben erlaubt (Eingabefeld mit Vorschlägen, kein festes
Dropdown); einzige Regel: keine Klammern (Prinzip 5). Bereits im Dokument
verwendete freie Typen erscheinen als eigene Vorschlagsgruppe zuerst.
Namenskonvention im Katalog: Slash-Paare auf den Primärbegriff reduziert
(„Fach / Fachgebiet" → `Fach`), Klammer-Zusätze umformuliert
(„Methode (wissenschaftlich)" → `Wissenschaftliche Methode`).

## Schnittstellen für KI-Integration

Die Web Component bietet den kompletten Tagging-Zyklus programmatisch an:

```js
const editor = document.querySelector('md-collab-editor')

// KI-Ausgabe eintragen (Zitat + Typ genügen):
const error = editor.addAnnotation({ quote: 'Weimar', type: 'Ort' })
// → null bei Erfolg; Fehlermeldung bei nicht auffindbarem Zitat (Halluzination)
//   oder Kreuzung mit bestehendem Tag

// Strukturierter Export (A2):
editor.getAnnotations()
// → [{id, quote, occurrence, type, entityId, start, end}] — Offsets gegen
//   das aktuelle Markdown, null bei verwaisten Tags

// Live-Beobachtung:
editor.addEventListener('annotations-change', (e) => e.detail.annotations)
```

## Modul-Landkarte

| Modul | Verantwortung | getestet |
|---|---|---|
| [src/annotations.js](../src/annotations.js) | pure Logik: Keyword ⇄ Annotation, Zitat → Offsets, Kreuzungscheck, Typ-Validierung | `test/annotations.test.mjs` |
| [src/entity-types.js](../src/entity-types.js) | Default-Typkatalog + Vorschlags-Builder | `test/entity-types.test.mjs` |
| [src/annotation-extension.js](../src/annotation-extension.js) | TipTap-Extension: Text-Index (Offset ⇄ ProseMirror-Position), Decorations, Klick-Handling | indirekt (Build/Lint) |
| [src/annotation-ui.js](../src/annotation-ui.js) | DOM-Bausteine: Tag-Dialog, Verwaltungs-Popup, Entitäten-Chips | indirekt |
| [src/annotation-controller.js](../src/annotation-controller.js) | Feature-Controller: Y.Array, Validierung, Dialog-Orchestrierung | indirekt |
| [server/collab.js](../server/collab.js) | Seed beim Laden, Keyword-Ableitung + Read-Back beim Speichern | `test/api-auth.test.mjs` (Infrastruktur) |
| [server/edu-sharing-api.js](../server/edu-sharing-api.js) | `cclom:general_keyword` lesen/schreiben (setProperty) | indirekt |

Die pure Logik ist bewusst DOM-/Yjs-frei und läuft identisch in Node
(Server-Seed/-Persistenz) und Browser (Anzeige/Validierung) — eine
Implementierung, keine Drift.

## Bekannte Grenzen & Ausbaustufen

- **`entityId`-Persistenz** — aktuell nur im Yjs-Dokument (s. Prinzip 5).
- **Blockübergreifende Tags** — die Auswahl darf keine Absätze überspannen
  (Zitate mit Zeilenumbruch wären im Keyword-Roundtrip nicht stabil).
- **Ebene-1-Typen als Block-Rollen** — didaktische Typen (`Einleitung`,
  `Zusammenfassung`) werden derzeit wie Span-Tags behandelt; block-genaues
  Taggen wäre eine eigene Ausbaustufe.
- **Vorkommen-Zählung Markdown vs. Editor-Text** — die Auflösung nutzt den
  Klartext des Editors, der Server sucht im Markdown; bei Zitaten, die in
  Markdown-Syntax vorkommen (sehr selten), kann sich die Vorkommens-Nummer
  unterscheiden.
- **Yjs Relative Positions** als sekundärer Anker für noch robustere
  Verankerung bei starkem Umformulieren.
