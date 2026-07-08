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
 *
 * i18n note: the VALUES below (and the persisted keyword built from them)
 * always stay German — they are the actual data stored in edu-sharing, and
 * changing them would break the roundtrip for already-tagged documents.
 * Only the on-screen LABEL is translated for the English UI, via
 * TYPE_LABELS_EN / GROUP_LABELS_EN + typeLabel()/groupLabel() below.
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

/** English labels for the default group headings (display only, see i18n note above). */
export const GROUP_LABELS_EN = {
  'Didaktik / Wissensart': 'Didactics / Knowledge Type',
  'Personen, Institutionen, Orte': 'People, Institutions, Places',
  'Bildungsangebote & Curriculum': 'Educational Offerings & Curriculum',
  'Unterricht & Szenario': 'Teaching & Scenario',
  'Wissenschaft & Fachinhalt': 'Science & Subject Content',
  'Zeit, Recht, Organisation': 'Time, Law, Organization',
  'KI & digitale Werkzeuge': 'AI & Digital Tools',
  'Support & Dokumentation': 'Support & Documentation',
  'Bereits verwendet': 'Already used',
}

/** English labels for the default type VALUES (display only, see i18n note above). */
export const TYPE_LABELS_EN = {
  Einleitung: 'Introduction', Motivation: 'Motivation', Definition: 'Definition',
  Lerninhalt: 'Learning content', Beispiel: 'Example', Aufgabe: 'Exercise',
  Lösung: 'Solution', These: 'Thesis', Beweis: 'Proof', Verfahren: 'Procedure',
  Algorithmus: 'Algorithm', Methode: 'Method', Lernziel: 'Learning objective',
  Rahmenkontext: 'Context', Kommentar: 'Comment', Anekdote: 'Anecdote',
  Zusammenfassung: 'Summary', Übung: 'Practice', Reflexion: 'Reflection',
  Feedback: 'Feedback', Vertiefung: 'Deep dive', Exkurs: 'Digression',
  Merksatz: 'Key takeaway', Hinweis: 'Note', Warnung: 'Warning',
  Voraussetzung: 'Prerequisite',
  Person: 'Person', Organisation: 'Organization', Ort: 'Place',
  Veranstaltung: 'Event', Beruf: 'Occupation',
  Bildungsangebot: 'Educational offering', Bildungsgang: 'Educational program',
  Bildungsmaterial: 'Educational material', Kompetenz: 'Competency',
  Fach: 'Subject', Bildungsbereich: 'Educational domain',
  Klassenstufe: 'Grade level', Schulform: 'School type',
  Anforderungsniveau: 'Difficulty level', Bildungsstandard: 'Educational standard',
  Stundenumfang: 'Lesson duration', Thema: 'Topic', Themenbereich: 'Topic area',
  Unterthema: 'Subtopic',
  Sozialform: 'Social form', Unterrichtsphase: 'Lesson phase',
  Zielgruppe: 'Target group', Medium: 'Medium',
  Fachbegriff: 'Term', Konzept: 'Concept', Hypothese: 'Hypothesis',
  Theorie: 'Theory', Experiment: 'Experiment',
  'Wissenschaftliche Methode': 'Scientific method', Datensatz: 'Dataset',
  Formel: 'Formula', Größe: 'Quantity', Werk: 'Work', Quelle: 'Source',
  Datum: 'Date', Frist: 'Deadline', Recht: 'Law',
  Tool: 'Tool', Prompt: 'Prompt', 'KI-Skill': 'AI skill',
  Problem: 'Problem', Ursache: 'Cause', Lösungsschritt: 'Solution step',
  Workaround: 'Workaround', Fehlermeldung: 'Error message',
  Systemkomponente: 'System component', Konfiguration: 'Configuration',
  'UI-Element': 'UI element', Rolle: 'Role', FAQ: 'FAQ',
}

/** Display label for a default type VALUE — falls back to the value itself
 * for German or for custom types without a translation entry. */
export function typeLabel(value, lang = 'de') {
  return lang === 'en' ? (TYPE_LABELS_EN[value] || value) : value
}

/** Display label for a default group heading — same fallback rule. */
export function groupLabel(label, lang = 'de') {
  return lang === 'en' ? (GROUP_LABELS_EN[label] || label) : label
}

/**
 * Build the suggestion list for the tag dialog: custom types already used in
 * the document first (group "Bereits verwendet"/"Already used"), then the
 * full default catalog with its group labels. Used defaults are not
 * duplicated. `value` is always the canonical (German) value that gets
 * persisted; `label` is the translated display text (see i18n note above).
 * @returns {[{value: string, label: string, group: string}]}
 */
export function buildTypeOptions(usedTypes = [], lang = 'de') {
  const defaults = new Set(DEFAULT_TYPE_GROUPS.flatMap((g) => g.types))
  const custom = [...new Set(usedTypes)].filter((t) => !defaults.has(t))
  return [
    ...custom.map((value) => ({ value, label: value, group: groupLabel('Bereits verwendet', lang) })),
    ...DEFAULT_TYPE_GROUPS.flatMap((g) => g.types.map((value) => ({
      value, label: typeLabel(value, lang), group: groupLabel(g.label, lang),
    }))),
  ]
}
