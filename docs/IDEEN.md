# Ideen-Backlog

Laufendes Verzeichnis aller Funktionsideen mit Entscheidungsstand. Wird bei
jeder Ideen-Diskussion aktualisiert (Absprache 2026-07-17).

**Leitplanke (verbindlich):** Einzige dauerhafte Datenablage ist das
edu-sharing-Repository (Properties, Keywords, Child-IOs, Kommentare). Der
Editor-Server legt nichts dauerhaft ab — keine SQLite/Redis-Persistenz.

## In Umsetzung / umgesetzt

| Idee | Status | Notizen |
|---|---|---|
| Verankerte Randkommentare | **umgesetzt 2026-07-17** | Kommentare mit »Zitat«-Anker markieren die Stelle im Text (gelbe Markierung); Klick öffnet das Panel am Kommentar. Ablage: edu-sharing-Kommentar-API (unverändert). |
| Medienverwaltungs-Panel | **umgesetzt 2026-07-17** | Ein Einstiegspunkt: der 🖼-Button öffnet das Panel (⬆ Hochladen, 🔗 Bild-URL, Verwaltung) — der separate 🗂-Button wurde wieder eingespart. Panel: hochgeladene Editor-Bilder (mdimg-Child-IOs) mit Vorschau, „im Text"-Kennzeichnung, erneutem Einfügen, Löschen (Server-Guard: nur mdimg-Children des Knotens). OFFEN zu verifizieren (Login nötig): Upload/Child-IO-Verhalten unter ccm:map (Sammlungen) — childio ist nur für ccm:io-Eltern validiert; erwartet, aber unbewiesen, dass mdimg-Children nicht als Sammlungsinhalt erscheinen. |
| Bildgröße einstellbar | **umgesetzt 2026-07-17** | Bild anklicken → S/M/L/⛶ (240/480/720 px/Original); Breite persistiert als CommonMark-legales `<img … width>`-Inline-HTML (GitHub-kompatibel), ⛶ macht das Bild wieder zu reinem Markdown. |
| Export: Markdown + Druck | **umgesetzt 2026-07-17** | ⬇ MD lädt den aktuellen Stand als .md (Dateiname = Node-ID); 🖨 öffnet ein eigenes Druckfenster nur mit dem Dokument (Webview-tauglich; Strg+P bleibt per Print-CSS sauber). Keine Datenablage. |

## Offen (entschieden: interessant, noch nicht beauftragt)

| Idee | Aufwand | Notizen |
|---|---|---|
| Restart-Schutz ohne Persistenz (Boot-ID) | ~0,5–1 T | Verhindert doppelte Inhalte/Pillen, wenn ein offener Browser-Tab einen Server-Neustart (Deploy) überlebt. Speicherfrei: Server sendet eine Zufalls-ID seines Starts mit; erkennt der Client nach Reconnect eine neue ID, lädt er das Dokument frisch statt seinen alten Stand hineinzumischen. Heute wird der Fall beim Speichern geheilt (Dedupe), nicht verhindert. |
| Anker-Reparatur beim Speichern | Stunden–1 T | Richtung lt. Absprache: Links ins Leere (gelöschte Überschrift) nicht nur melden, sondern reparieren bzw. entfernen. Zu klären: automatisch entlinken (Linktext bleibt als Text) oder Redakteur fragen. TOC-Links repariert der Server-Refresh bereits selbst. |
| LTI-Integration | ~1,5–2,5 W | Konzept in docs/LTI-INTEGRATION.md. Plattform-Registrierung = Env-Konfiguration, keine Nutzerdaten-Ablage; Nonce/State in-memory. |
| E2E-Tests mit Login (Staging) | manuell | Bild-Upload, Kommentar schreiben/löschen — führt der Nutzer selbst durch (Logins macht der Agent nicht). |

## Später (nette Idee, bewusst zurückgestellt)

| Idee | Notizen |
|---|---|
| Didaktische Vorlagen | Ein-Klick-Gerüste aus dem Rollenkatalog (z. B. Einleitung → Definition → Beispiel → Aufgabe → Zusammenfassung als vorbereitete :::-Blöcke). Entscheidung 2026-07-17: „jetzt nicht". |

## Verworfen (mit Begründung)

| Idee | Begründung |
|---|---|
| extension-database / Redis (persistente Yjs-Snapshots) | Verstößt gegen die Leitplanke „Datenablage nur edu-sharing". Ersetzt durch „Restart-Schutz ohne Persistenz" (oben). |
| Versionierung im Editor | Nutzer-Entscheidung („daten im editor speichern machen wir nicht"); edu-sharing-Versions-API liefert für Property-Historie zudem leere Properties (empirisch geprüft 07/2026). Vermerk an die Technik erfolgt durch den Nutzer. |
| KI-Glossar-Definitionen | Entscheidung 2026-07-17: „muss nicht sein". |
| Unterstreichen / Highlight / Textausrichtung | Kein Standard-Markdown (CommonMark/GFM) — Kompatibilitäts-Doktrin: Roundtrip bleibt verlustfrei. |
| Overlay-/Panel-Inhaltsverzeichnis | Zweimal verworfen (verdeckt Arbeitsfläche); stattdessen In-Content-TOC als ::: inhaltsverzeichnis umgesetzt. |
