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
| `Y.Array('annotations')` | Gemeinsamer Datenkanal im selben Yjs-Dokument wie der Text — Tags synchronisieren wie Textänderungen zwischen allen Sitzungen |
| Tag-Dialog / Verwaltungs-Popup / Chips-Leiste | Bedienoberfläche: Auswahl markieren → Typ vergeben, bestehende Tags anklicken/entfernen |
| Server (`server/collab.js`) | Lädt Tags beim Öffnen aus edu-sharing, schreibt sie beim Speichern zurück |

**Der Markdown-Text selbst enthält keinerlei Tagging-Syntax.** Die Anzeige im
Editor ist reine Oberflächen-Darstellung; exportierter/gespeicherter Text ist
mit und ohne Tags identisch.

## Datenmodell: Zitat + Typ — bewusst NICHT Position + Anzahl

**Ein Tag besteht aus genau zwei fachlich relevanten Werten: dem exakten
Textzitat und dem Typ.** Persistiert wird das als edu-sharing General
Keyword in der Form:

```
Weimar (Ort)
huygenssches Prinzip (Fachbegriff)
```

Das ist die **einzige dauerhaft gespeicherte Information.** Weder eine
Zeichenposition noch eine Vorkommens-Nummer werden nach edu-sharing
geschrieben — beide existieren nur flüchtig zur Laufzeit im Editor und
werden bei jedem Zugriff neu berechnet, indem der Text nach dem Zitat
durchsucht wird.

## Ablauf

1. **Laden:** Das Keyword `Weimar (Ort)` wird geparst, der Text nach dem
   ersten Vorkommen von "Weimar" durchsucht und daraus ein Tag rekonstruiert.
2. **Anzeige:** Der Editor sucht laufend nach dem Zitat und hebt **alle**
   Fundstellen im aktuellen Text hervor — unabhängig davon, wie oft
   "Weimar" vorkommt, bleibt es eine Pille.
3. **Speichern:** Aus allen aktiven Tags wird die Keyword-Liste neu gebaut
   und dedupliziert; bestehende, nicht dem Tagging-Muster entsprechende
   Keywords bleiben unangetastet.

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
