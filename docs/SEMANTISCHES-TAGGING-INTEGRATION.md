# Semantisches Tagging im Markdown-Editor — Integration & Limitierungen

Kurzüberblick für Integrator:innen und Stakeholder: **wie** semantisches
Tagging in den kollaborativen Markdown-Editor eingebunden ist und **wo die
Grenzen** des Modells liegen. Für die ausführliche Design-Begründung siehe
[SEMANTISCHES-TAGGING.md](./SEMANTISCHES-TAGGING.md).

## Was das Feature tut

Im Editor markierbare Textstellen ("Weimar", "huygenssches Prinzip") werden
mit einem freiwählbaren **Typ** versehen ("Ort", "Fachbegriff") und als
**Entitäts-Pillen** dargestellt. Die Markierungen werden kollaborativ
synchronisiert und beim Speichern nach edu-sharing übertragen.

## Integration in den Editor

Das Tagging ist vollständig in die bestehende Web Component
`<md-collab-editor>` integriert, ohne das Markdown-Format zu berühren:

| Baustein | Rolle |
|---|---|
| `AnnotationController` | Fachlogik pro Editor-Instanz: legt Tags an, prüft Regeln, steuert Dialoge und die Entitäten-Leiste |
| TipTap-Extension | Zeigt Tags als **Hervorhebung im Text** (ProseMirror-Decoration) — der Text selbst bleibt unverändert |
| `Y.Array('annotations')` | **Standoff:** Tags liegen als eigene Liste NEBEN dem Text im selben Yjs-Dokument, nicht im Text selbst — Tags synchronisieren wie Textänderungen zwischen allen Sitzungen |
| Tag-Dialog / Verwaltungs-Popup / Chips-Leiste | Bedienoberfläche: Auswahl markieren → Typ vergeben, bestehende Tags anklicken/entfernen |
| Server (`server/collab.js`) | Lädt Tags beim Öffnen aus edu-sharing, schreibt sie beim Speichern zurück |

**Der Markdown-Text selbst enthält keinerlei Tagging-Syntax.** Die Anzeige im
Editor ist reine Oberflächen-Darstellung; exportierter/gespeicherter Text ist
mit und ohne Tags identisch.

**Beispiel Standoff:** Der Satz `Die Universität Weimar wurde 1919
gegründet.` bleibt im Markdown exakt so stehen. Das Tag selbst existiert nur
als separater Eintrag `{quote: "Weimar", type: "Ort"}` im `Y.Array` — nicht
etwa als `Die Universität [Weimar]{Ort} wurde …` im Text. Würde man den Text
exportieren (z. B. für eine KI-Weiterverarbeitung), sieht man dem Ergebnis
nicht an, dass überhaupt getaggt wurde.

## Datenmodell: Zitat + Typ — bewusst NICHT Position + Anzahl

**Ein Tag besteht aus genau zwei fachlich relevanten Werten: dem exakten
Textzitat und dem Typ.** Persistiert wird das im edu-sharing-Property
**`cclom:general_keyword`** in der Form:

```
Weimar (Ort)
huygenssches Prinzip (Fachbegriff)
```

Das ist die **einzige dauerhaft gespeicherte Information.** Weder eine
Zeichenposition noch eine Vorkommens-Nummer werden nach edu-sharing
geschrieben — beide existieren nur flüchtig zur Laufzeit im Editor und
werden bei jedem Zugriff neu berechnet, indem der Text nach dem Zitat
durchsucht wird.

## Zwei Speicherorte: flüchtig (live) vs. dauerhaft (edu-sharing)

Entitäten existieren während einer Sitzung an zwei unterschiedlichen Orten,
die klar getrennt sind:

| | Live-Abgleich (während der Sitzung) | Dauerhafte Speicherung |
|---|---|---|
| Ort | `Y.Array('annotations')` im Yjs-Dokument, im Arbeitsspeicher des Collab-Servers (`server/collab.js`) | `cclom:general_keyword` am edu-sharing-Knoten |
| Transportweg | WebSocket-Verbindung (`/collab`) zwischen allen offenen Editor-Sitzungen — jede Änderung wird sofort an alle verbundenen Clients gesendet | HTTP-REST-Aufruf (`setProperty`) vom Collab-Server an die edu-sharing-API |
| Format | strukturiertes Objekt `{id, quote, occurrence, type, entityId?}` | Text-Keyword `Name (Typ)`, z. B. `Weimar (Ort)` |
| Zeitpunkt | sofort bei jeder Änderung (Tag anlegen/löschen), unabhängig vom Speichern des Textes | debounced (Standard: einige Sekunden nach der letzten Änderung), spätestens sofort beim expliziten „Jetzt speichern" oder wenn die letzte Sitzung das Dokument schließt |
| Überlebt Sitzungsende? | serverseitig ja, solange mindestens ein Client verbunden ist bzw. ein kurzlebiger In-Memory-Cache nach dem Trennen (siehe unten); nicht dauerhaft | ja — das ist die eigentliche "Wahrheit" |

**Live-Transport im Detail:** Solange ein Dokument geöffnet ist, laufen
Text und Entitäten über **eine gemeinsame WebSocket-Verbindung** pro
Client zum Collab-Server. Der Server hält den aktuellen Stand als
Yjs-Dokument im Arbeitsspeicher (`docState`/das Hocuspocus-Dokument selbst)
und broadcastet jede Änderung an alle anderen verbundenen Sitzungen — so
sehen mehrere gleichzeitig arbeitende Nutzer:innen neue oder gelöschte Tags
in Echtzeit, ohne dass zwischendurch etwas in edu-sharing geschrieben wird.

**Dauerhafte Speicherung im Detail:** Dieser Live-Zustand wird erst beim
tatsächlichen Speichern in `cclom:general_keyword` überführt: aus dem
`Y.Array` wird die Keyword-Liste gebaut und per REST-Call an edu-sharing
geschrieben. Erst nach **bestätigtem Rücklesen** aus edu-sharing gilt die
Änderung als sicher gespeichert (edu-sharing kann Schreibversuche ohne
Berechtigung mit `200 OK` beantworten und die Änderung trotzdem verwerfen —
der Server verifiziert deshalb aktiv, statt der Erfolgsmeldung zu
vertrauen). Solange kein Client verbunden ist, existiert der Live-Zustand
nur noch als kurzlebiger Zwischenspeicher auf dem Server (überlebt keinen
Server-Neustart) — die einzige wirklich dauerhafte Quelle ist immer
`cclom:general_keyword` in edu-sharing selbst.

**Beispiel durchgängig:** Nutzer:in A markiert "Weimar" als `Ort`. Sofort
(< 1 Sekunde) sieht Nutzer:in B, die dasselbe Dokument geöffnet hat, die
neue Pille — übertragen per WebSocket, gespeichert nur im `Y.Array` im
Arbeitsspeicher des Servers. Passiert in edu-sharing zu diesem Zeitpunkt
noch **nichts**. Erst wenn (a) die Debounce-Zeit abläuft, (b) jemand „Jetzt
speichern" klickt, oder (c) A und B beide das Dokument schließen, schreibt
der Server `Weimar (Ort)` per REST-Aufruf in `cclom:general_keyword` — ab
diesem Moment ist der Tag auch außerhalb des Editors sichtbar (z. B. in der
edu-sharing-Suche oder -Metadatenansicht).

## Ablauf

1. **Laden:** `cclom:general_keyword` wird aus edu-sharing gelesen, jedes
   Keyword im Muster `Name (Typ)` geparst, der Text nach dem ersten
   Vorkommen von "Weimar" durchsucht und daraus ein Tag rekonstruiert.
   Keywords ohne dieses Muster (z. B. "Optik") werden als normale,
   nicht-getaggte Keywords unangetastet übernommen.
2. **Anzeige:** Der Editor sucht laufend nach dem Zitat und hebt **alle**
   Fundstellen im aktuellen Text hervor — unabhängig davon, wie oft
   "Weimar" vorkommt, bleibt es eine Pille.
3. **Speichern:** Aus allen aktiven Tags wird die Keyword-Liste neu gebaut,
   dedupliziert und zurück in `cclom:general_keyword` geschrieben; bestehende,
   nicht dem Tagging-Muster entsprechende Keywords bleiben unangetastet.

## Typen: Vorschlagskatalog + freie Eingabe

Der Tag-Dialog schlägt einen **Default-Katalog** an Typen vor (gruppiert
nach Didaktik/Wissensart und Entitätsdomänen wie Personen/Orte, Curriculum,
Wissenschaft, KI-Tools). Nutzer:innen sind daran **nicht gebunden** — jeder
freie Typ ist erlaubt, solange er keine Klammern enthält (das würde das
`Name (Typ)`-Muster beim Rücklesen brechen). Bereits im Dokument verwendete
freie Typen werden im Dialog als eigene Vorschlagsgruppe vorangestellt.

**Beispiel:** Beim Markieren von "Kartoffel" schlägt der Dialog Typen wie
`Fachbegriff`, `Bildungsangebot` oder `Thema` aus dem Katalog vor. Passt
keiner davon, kann frei `Nutzpflanze` eingetippt werden — dieser Typ wird
als `Kartoffel (Nutzpflanze)` genauso gespeichert wie ein Katalog-Typ, und
erscheint danach in derselben Sitzung ganz oben in der Vorschlagsliste
("Bereits verwendet"), falls "Nutzpflanze" erneut gebraucht wird.

## Schnittstelle für KI-generiertes Tagging

```js
editor.addAnnotation({ quote: 'Weimar', type: 'Ort' })
```

Auch hier genügen **Zitat und Typ** — keine Zeichenposition. Findet der
Editor das Zitat nicht im Text, wird die Annotation mit einer Fehlermeldung
abgelehnt (Schutz vor KI-Halluzinationen).

## Limitierungen

- **Keine exakte Textstelle gespeichert.** Position (`start`/`end`) ist zur
  Laufzeit ein abgeleiteter Wert, kein persistenter. Nach dem nächsten Laden
  kann sich die berechnete Position leicht verschieben, wenn sich der Text
  vor der Fundstelle geändert hat — fachlich unproblematisch, da nur die
  *aktuelle* Position für die Anzeige gebraucht wird.
- **Keine Vorkommens-Anzahl gespeichert.** Kommt ein Zitat mehrfach im Text
  vor, weiß edu-sharing nach dem Speichern nicht, auf welches Vorkommen sich
  das Tag ursprünglich bezog — nur „dieses Zitat trägt diesen Typ". Beim
  erneuten Laden wird deshalb immer das *erste* Vorkommen als Anker
  verwendet; angezeigt werden trotzdem alle Vorkommen.
- **Kein Schutz vor Wortlaut-Änderung.** Wird der zitierte Text bearbeitet
  oder gelöscht, kann das Tag nicht mehr verankert werden ("verwaist"). Es
  geht nicht automatisch verloren (bleibt als Keyword erhalten), wird aber
  im Editor nicht mehr hervorgehoben, bis es wieder auffindbar ist oder
  manuell entfernt wird.
- **Keine block- oder absatzübergreifenden Tags.** Eine Markierung darf
  keinen Zeilenumbruch enthalten.
- **Keine sich kreuzenden Tags.** Verschachtelte und deckungsgleiche Tags
  sind erlaubt, echtes Überkreuzen zweier Markierungsgrenzen wird abgelehnt.
  **Beispiel:** Im Satz „Die Universität Weimar ist bekannt" darf
  `Universität Weimar` als `Organisation` UND darin verschachtelt `Weimar`
  als `Ort` getaggt werden (eine Markierung liegt vollständig in der
  anderen). Würde man jedoch `Universität Weimar` als `Organisation` und
  separat `Weimar ist` als `Aussage` markieren wollen, überschneiden sich
  beide nur teilweise („kreuzend") — das lehnt der Editor mit einer
  Fehlermeldung ab.
- **Mehrdeutigkeit bei gleichem Zitat, unterschiedlichem Typ.** Wird
  derselbe Wortlaut zweimal mit unterschiedlichem Typ getaggt, überlagern
  sich beide Hervorhebungen an denselben Textstellen — visuell nicht
  differenzierbar.
- **Kein zusätzliches Identifikations-Merkmal in edu-sharing.** Nur
  Name + Typ werden persistiert; eine optionale Verknüpfung zu einem
  Normdaten-Objekt (`entityId`) existiert nur während der Editor-Sitzung im
  Yjs-Dokument, nicht dauerhaft in edu-sharing.

## Fazit

Das Modell ist bewusst **einfach und lesbar** gehalten: ein Tag ist ein
Textzitat mit Typ, gespeichert als menschenlesbares Keyword — ohne
Positions- oder Zählinformation, die außerhalb der laufenden Editor-Sitzung
ohnehin nicht stabil wäre. Die Konsequenz daraus ist eine geringere
Präzision bei mehrfach vorkommenden identischen Zitaten, im Gegenzug aber
volle Kompatibilität mit dem bestehenden edu-sharing-Keyword-Feld und
robustes, KI-taugliches Tagging ohne Zeichen-Offset-Arithmetik.
