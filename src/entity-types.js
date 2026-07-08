/**
 * Default entity-type catalog for semantic tagging — suggestions only, free
 * custom types remain allowed (validated by isValidType in annotations.js).
 *
 * Two levels (per spec 07/2026):
 *   level 1: knowledge kind / didactic semantics (role of a text block)
 *   level 2: entity types markable in running text, grouped by domain
 *
 * Naming rules for type VALUES (they become part of the persisted keyword
 * "Name (Typ)"):
 *   - no parentheses (would break the keyword roundtrip parser) — e.g.
 *     "Methode (wissenschaftlich)" → "Wissenschaftliche Methode"
 *   - slash pairs reduced to the primary term — e.g. "Fach / Fachgebiet" → "Fach"
 */
export const DEFAULT_TYPE_GROUPS = [
  {
    label: 'Didaktik / Wissensart',
    types: [
      'Einleitung', 'Motivation', 'Definition', 'Lerninhalt', 'Beispiel',
      'Aufgabe', 'Lösung', 'These', 'Beweis', 'Verfahren', 'Algorithmus',
      'Methode', 'Lernziel', 'Rahmenkontext', 'Kommentar', 'Anekdote',
      'Zusammenfassung', 'Übung', 'Reflexion', 'Feedback', 'Vertiefung',
      'Exkurs', 'Merksatz', 'Hinweis', 'Warnung', 'Voraussetzung',
    ],
  },
  {
    label: 'Personen, Institutionen, Orte',
    types: ['Person', 'Organisation', 'Ort', 'Veranstaltung', 'Beruf'],
  },
  {
    label: 'Bildungsangebote & Curriculum',
    types: [
      'Bildungsangebot', 'Bildungsgang', 'Bildungsmaterial', 'Kompetenz',
      'Fach', 'Bildungsbereich', 'Klassenstufe', 'Schulform',
      'Anforderungsniveau', 'Bildungsstandard', 'Stundenumfang',
      'Thema', 'Themenbereich', 'Unterthema',
    ],
  },
  {
    label: 'Unterricht & Szenario',
    types: ['Sozialform', 'Unterrichtsphase', 'Zielgruppe', 'Medium'],
  },
  {
    label: 'Wissenschaft & Fachinhalt',
    types: [
      'Fachbegriff', 'Konzept', 'Hypothese', 'Theorie', 'Experiment',
      'Wissenschaftliche Methode', 'Datensatz', 'Formel', 'Größe',
      'Werk', 'Quelle',
    ],
  },
  {
    label: 'Zeit, Recht, Organisation',
    types: ['Datum', 'Frist', 'Recht'],
  },
  {
    label: 'KI & digitale Werkzeuge',
    types: ['Tool', 'Prompt', 'KI-Skill'],
  },
  {
    label: 'Support & Dokumentation',
    types: [
      'Problem', 'Ursache', 'Lösungsschritt', 'Workaround', 'Fehlermeldung',
      'Systemkomponente', 'Konfiguration', 'UI-Element', 'Rolle', 'FAQ',
    ],
  },
]

/**
 * Build the suggestion list for the tag dialog: custom types already used in
 * the document first (group "Bereits verwendet"), then the full default
 * catalog with its group labels. Used defaults are not duplicated.
 * @returns {[{value: string, group: string}]}
 */
export function buildTypeOptions(usedTypes = []) {
  const defaults = new Set(DEFAULT_TYPE_GROUPS.flatMap((g) => g.types))
  const custom = [...new Set(usedTypes)].filter((t) => !defaults.has(t))
  return [
    ...custom.map((value) => ({ value, group: 'Bereits verwendet' })),
    ...DEFAULT_TYPE_GROUPS.flatMap((g) => g.types.map((value) => ({ value, group: g.label }))),
  ]
}
