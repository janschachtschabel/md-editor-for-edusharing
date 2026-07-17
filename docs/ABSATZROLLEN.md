# Absatzrollen (didaktische Block-Markierung) — getrennt von Entitäten

**Status: umgesetzt (2026-07-09).** Knüpft an
[SEMANTISCHES-TAGGING.md](SEMANTISCHES-TAGGING.md) an (dort „Bekannte Grenzen →
Ebene-1-Typen als Block-Rollen").

**Umsetzung im Code:**

| Baustein | Datei |
|---|---|
| Geteiltes Vokabular + `roleSlug`/`roleLabel` (Ebene 1 → Rollen, Ebene 2 → Entitäten) | [src/entity-types.js](../src/entity-types.js) |
| TipTap-Node `roleBlock` (`:::`-Container, Befehle `setRole`/`unsetRole`) | [src/role-block.js](../src/role-block.js) |
| Markdown-Roundtrip (marked-Tokenizer + Turndown-Regel) | [src/markdown.js](../src/markdown.js) |
| Rollen-Auswahl in der Toolbar (`<select>`) + Rollen-Chips-Leiste | [src/role-ui.js](../src/role-ui.js) (Verdrahtung: [src/md-collab-editor.js](../src/md-collab-editor.js)) |
| Editor-Styling (Container + Label-Chip) | [public/style.css](../public/style.css) |
| Tests: Roundtrip `:::`, Katalog-Split, `roleSlug`/`roleLabel`, Select/Chips im jsdom-Harness | `test/roundtrip.test.mjs`, `test/entity-types.test.mjs`, `test/component.test.mjs` |

**Reservierte freie Slugs:** `glossar` (Glossar-Feature,
[src/glossary.js](../src/glossary.js), 📇-Button) und `inhaltsverzeichnis`
(Inhaltsverzeichnis, [src/toc.js](../src/toc.js), ☰-Button) werden als feste
Anker genutzt — die Buttons ersetzen einen vorhandenen Block statt einen
zweiten anzuhängen, und der Server bringt BEIDE Blöcke bei jedem Speichern
automatisch auf den aktuellen Stand ([server/doc-blocks.js](../server/doc-blocks.js)).
Als manuelle Rollen daher besser nicht zweckentfremden.

Rollen erreichen `cclom:general_keyword` **per Konstruktion** nie — sie stehen im
Markdown (Compendium-Property), Entitäten laufen weiter über den Standoff→Keyword-Pfad.

**Granularität (umgesetzt):**

- **Ganzer Absatz:** Cursor in den Absatz → Rolle im `¶ Rolle …`-Select wählen
  (bzw. „— keine Rolle —" entfernt sie).
- **Teil-Auswahl / Untermarkierung:** Wird nur ein Satz(teil) markiert und eine
  Rolle gewählt, **teilt der Editor den Absatz automatisch**: der markierte Teil
  wird ein eigener Rollen-Block. Liegt er in einem bereits getaggten Absatz,
  **verschachtelt** sich der neue Block darin (z. B. ein `Merksatz` innerhalb
  einer `These`) — die umgebenden Sätze behalten ihre Rolle. Der Markdown
  nutzt dafür geschachtelte `:::` (fence-zählender Parser in `markdown.js`).
- **Rollen-Pillen:** Alle Absatzrollen erscheinen als **amberfarbene Chips** in
  einer eigenen Leiste unter der Toolbar (getrennt von den blauen Entitäten-
  Chips). Klick auf einen Chip springt zur Stelle, das ✕ entfernt die Rolle
  an Ort und Stelle (löst nur diesen Wrapper auf, un-nested nicht); **„alle ✕"**
  (ab 2 Rollen, mit Rückfrage) entfernt sämtliche Rollen des Dokuments auf
  einmal — der Inhalt bleibt unverändert.

---

*Ursprüngliche Entscheidungsvorlage (unverändert erhalten):*

## 1. Das Problem

Der Typ-Katalog mischt heute **zwei semantisch verschiedene Dinge** in einem
Mechanismus (Standoff-Span → `Name (Typ)`-Keyword):

| | Inline-Entität | Absatzrolle |
|---|---|---|
| Beispiele | `Weimar (Ort)`, `Anna Müller (Person)`, `Fotosynthese (Fachbegriff)` | `Einleitung`, `Definition`, `Merksatz`, `Aufgabe`, `Lösung` |
| Aussage | „diese **Textstelle** referenziert Entität X" | „dieser **Block** spielt Rolle Y im Lehr-/Lerngefüge" |
| Natur | **Metadaten über** den Text (Referenz) | **Struktur des** Textes selbst |
| Granularität | Wortgruppe (Span) | ganzer Absatz/Abschnitt, oft mehrere Blöcke |
| Gehört in `cclom:general_keyword`? | **ja** (Findbarkeit) | **nein** (Anforderung) |

Konkrete Fehlbilder des heutigen Einheitsmechanismus:

1. **Schlagwort-Verschmutzung:** Einen Absatz als „Einleitung" zu taggen erzeugt
   ein Keyword wie `Im Schuljahr 2025/26 führt die Physiklehrkraft … (Einleitung)`
   — bis zu 200 Zeichen Fließtext im Schlagwortfeld. Genau das soll nicht passieren.
2. **Mehrabsatz-Abschnitte sind unmöglich:** Zitate mit `\n` werden (korrekt,
   Audit F-T6) abgelehnt — eine „Einleitung" über zwei Absätze kann man gar
   nicht markieren.
3. **Anker-Fragilität am falschen Objekt:** Ein Zitat-Anker verwaist, sobald
   jemand den Absatzanfang umformuliert — für Referenzen tolerierbar (Pille wird
   grau), für *Struktur* absurd: die Einleitung bleibt die Einleitung, auch wenn
   ihr erster Satz neu formuliert wird.

## 2. Kernentscheidung: Ja — zwei verschiedene Vorgehensweisen

**Empfehlung: Mechanismus folgt Semantik.**

- **A · Inline-Entitäten** (Ebene-2-Typen): bleiben exakt wie heute —
  Standoff-Annotation, Zitat-Anker, Decoration, Persistenz als
  `Name (Typ)`-Keyword mit dem preserved-Merge-Muster.
- **B · Absatzrollen** (Ebene-1-Typen „Didaktik/Wissensart"): werden
  **Markup im Markdown selbst** — als Container-Block. Sie erscheinen
  **nirgends** in `cclom:general_keyword`.

### Warum Markup im Markdown hier KEIN Widerspruch zu Prinzip 1 ist

Prinzip 1 („Standoff statt Inline-Markup") wurde für **Entitäts-Spans**
entschieden — dort gilt es unverändert: viele Overlays, Verschachtelung,
Halluzinations-Prüfung, Text bleibt sauber. Absatzrollen sind eine andere
Kategorie: Sie sind **Struktur wie Überschriften** — und Überschriften stehen
selbstverständlich auch im Markdown. Für Struktur kehren sich die Argumente um:

- **Die KI-Pipeline profitiert**, statt gestört zu werden: `::: definition`
  ist wertvoller Kontext im Rohtext (welcher Absatz definiert, welcher übt) —
  ohne Zusatzabfrage, ohne Standoff-Auflösung.
- **Keine Anker-Fragilität:** Die Rolle klebt am Block, egal wie der Text
  darin umformuliert wird. „Verwaiste Rollen" können nicht existieren.
- **Reist mit dem Text:** Kopieren, Export, Versionierung, Diff — die
  Struktur bleibt erhalten. Standoff-Struktur ginge bei jedem Copy/Paste verloren.
- **Kollaboration gratis:** Teil des ProseMirror-/Yjs-Dokuments → synchronisiert
  über den bestehenden Kanal, kein zweites Y.Array, keine Extra-Persistenz.
- Overlap-Fähigkeit (der Hauptgrund für Standoff) wird nicht gebraucht:
  Rollen sind flach und exklusiv pro Block.

## 3. Syntax: Container-Direktive `:::` (empfohlen)

```markdown
::: einleitung
Im Schuljahr 2025/26 führt die Physiklehrkraft Anna Müller …
:::

::: definition
Die **Kartoffel** (Solanum tuberosum) ist eine Nutzpflanze aus der
Familie der Nachtschattengewächse.
:::

::: aufgabe
Untersucht in Gruppen je drei Kartoffelsorten und dokumentiert eure
Beobachtungen in einer Tabelle.
:::
```

**Warum `:::`:** de-facto-Standard für semantische Container im
Markdown-Ökosystem (Pandoc `fenced_divs`, `markdown-it-container`,
`remark-directive`, Docusaurus/VuePress-Admonitions). Menschen- und
LLM-lesbar; in naiven Renderern degradiert es harmlos (die `:::`-Zeilen
erscheinen als kurze Textzeilen, der Inhalt bleibt intakt).

**Verworfene Alternativen:**

| Syntax | Warum nicht |
|---|---|
| `<section data-role="…">` (HTML-Block) | CommonMark parst Markdown **innerhalb** von Block-HTML nicht → Tabellen/Listen im Abschnitt zerbrechen den Roundtrip |
| `> [!DEFINITION]` (GitHub-Alert-Stil) | semantisch ein Blockquote; jede Zeile braucht `>`-Präfix — Tabellen/Listen darin sind fehleranfällig; gedacht für Hinweis-Kästen, nicht für Inhaltsstruktur |
| `<!-- role:einleitung -->` (Kommentare) | TipTap-Schema verwirft Kommentare beim Laden (Roundtrip-Verlust); unsichtbar = für Redaktion unwartbar |
| Standoff mit separatem Property (JSON) | Anker-Fragilität an Absätzen (s. o.), zweites Nicht-MDS-Property (Quirk #15), Struktur geht beim Kopieren verloren, KI sieht sie nicht |

**Rollen-Werte:** Slugs (klein, `a-z0-9-`): `einleitung`, `definition`,
`merksatz`, `beispiel`, `aufgabe`, `loesung`, `lernziel`, `zusammenfassung`, …
— abgeleitet aus der heutigen Ebene 1 (Mapping mit Umlaut-Transliteration,
Anzeige-Label bleiben `Definition`/`Lösung` inkl. EN-Übersetzung wie gehabt).
Freie Rollen erlaubt (gleiche Philosophie wie freie Typen), nur Slug-Zeichen.

**Regeln (v1):** flach — keine Verschachtelung von Rollen-Blöcken; eine Rolle
pro Block; beliebig viele Blöcke je Rolle im Dokument; Rolle ist optional
(unmarkierte Absätze bleiben normale Absätze).

### Granularität: Satz, Absatz oder Abschnitt?

Ein Rollen-Container umfasst **einen oder mehrere Blöcke** — beide Richtungen
der Granularität sind damit abgedeckt:

- **Mehrere Absätze** (z. B. eine dreiteilige Einleitung): ein Container um
  alle drei — genau der Fall, der mit Span-Tags unmöglich war.
- **Ein einzelner Satz:** möglich — der Satz wird dabei zu einem **eigenen
  (kurzen) Absatz** im Container:

  ```markdown
  ::: merksatz
  Strom fließt nur im geschlossenen Stromkreis.
  :::
  ```

  Editor-UX dazu: Markiert die Redaktion einen Satz **mitten in** einem Absatz
  und wählt eine Rolle, teilt der Editor den Absatz automatisch an den
  Auswahlgrenzen (Satz wird eigener Block im Container, Rest bleibt davor/
  danach). Die Teilung ist im Markdown sichtbar — das ist ehrlich, denn die
  Rolle *ist* Struktur.

- **Satz mitten im Absatz, ohne Teilung:** bewusst **nicht** vorgesehen (v1).
  Das bräuchte Inline-Syntax (Pandoc-Spans `[…]{.merksatz}`), die schlechter
  degradiert und den Roundtrip verkompliziert — und es ist didaktisch
  fragwürdig: Ein Satz, der wirklich eine eigene Rolle hat (Merksatz,
  Definition), verdient es typografisch auch, allein zu stehen. Wer nur eine
  **inhaltliche Stelle** in einem Fließtext-Satz auszeichnen will, ist beim
  Entitäts-Tagging (Mechanismus A) richtig — die Grenze zwischen A und B ist
  also auch eine Bedienungs-Leitplanke, keine Einschränkung.

## 4. Umsetzung im Editor (Skizze)

1. **TipTap-Node `roleBlock`** — `group: block, content: block+`,
   Attribut `role`; gerendert als `<section data-role="…">` mit CSS-Label-Chip
   oben links (`::before { content: attr(data-role) }`) und dezenter linker
   Kante. Teil des Schemas → wandert automatisch durch Yjs.
2. **Markdown-Roundtrip** ([src/markdown.js](../src/markdown.js), bewährtes Muster):
   - Laden: marked-Block-Extension (Tokenizer für `^::: (slug)$ … ^:::$`)
     → `<section data-role>`; Inhalt wird normal als Markdown geparst.
   - Speichern: Turndown-Regel `section[data-role]` → `::: role\n…\n:::`.
   - Absicherung in `test/roundtrip.test.mjs` (Probe + Stabilität `md2 === md3`).
3. **UI:** Toolbar-Dropdown „¶ Rolle" (setzt/entfernt die Rolle des aktuellen
   Blocks bzw. umschließt die Auswahl); die heutige Fehlermeldung „Auswahl darf
   keine Absätze überspannen" im Entitäts-Dialog bekommt einen Hinweis
   „…dafür gibt es Absatzrollen".
4. **Katalog-Split** ([src/entity-types.js](../src/entity-types.js)):
   `DEFAULT_TYPE_GROUPS` verliert die Gruppe „Didaktik / Wissensart" (→ wird
   `BLOCK_ROLE_GROUP`); der Entitäts-Dialog schlägt nur noch Ebene 2 vor.
   i18n-Labels wandern mit.
5. **Persistenz: nichts Neues.** Die Rolle steht im Markdown → landet
   automatisch im Compendium-Property. `annotationsToKeywords`/`preserved`-Logik
   bleibt unberührt; Rollen erreichen `cclom:general_keyword` per Konstruktion nie.

## 5. Migration & Auswertbarkeit

- **Bestand:** Es gibt praktisch keine produktiven Ebene-1-Span-Tags (Feature
  ist neu). Vorhandene würden beim Laden weiter als normale Entitäts-Pillen
  erscheinen und können manuell in Rollen umgewandelt werden — keine
  Automigration nötig. Optional: Ladehinweis, wenn ein Keyword-Typ ein
  bekannter Rollenname ist.
- **Auswertung:** Rollen sind im Markdown trivial maschinenlesbar
  (`^::: (\w+)`) — für Statistik/Suche über Texte hinweg reicht das. Sollte
  später ein Repo-Feld gewünscht sein (z. B. „welche Kompendien haben
  Aufgaben?"), lässt sich eine Rollen-Liste additiv in ein eigenes Property
  spiegeln (gleiches Merge-Muster wie Keywords) — bewusst **nicht** Teil v1.

## 6. Aufwand & Empfehlung

**Aufwand:** ~2–4 PT (Node + Roundtrip-Regeln + Tokenizer + Dropdown +
Katalog-Split + Tests). Kein neuer Sync-Kanal, keine neue Persistenz, keine
Server-Änderung.

**Empfehlung:** Zwei Vorgehensweisen, wie oben — **A** Entitäten unverändert
(Standoff → Keywords), **B** Absatzrollen als `:::`-Container im Markdown
(nie in den Schlagwörtern). Der Mechanismus folgt damit der Semantik:
Referenz-Metadaten stehen neben dem Text, Struktur steht im Text.
