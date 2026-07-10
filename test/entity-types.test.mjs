// Unit tests for the default entity-type catalog and the suggestion builder
// (defaults grouped, already-used custom types merged in, free types allowed).
import {
  DEFAULT_TYPE_GROUPS, DEFAULT_BLOCK_ROLES, buildTypeOptions, roleSlug, roleLabel,
} from '../src/entity-types.js'
import { isValidType } from '../src/annotations.js'

let fail = 0
function check(name, ok, extra = '') {
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : `→ ${extra}`)
}

// --- catalog integrity ---------------------------------------------------------
const allDefaults = DEFAULT_TYPE_GROUPS.flatMap((g) => g.types)
check('catalog has groups with label and types',
  DEFAULT_TYPE_GROUPS.length >= 7 && DEFAULT_TYPE_GROUPS.every((g) => g.label && g.types.length > 0))
check('no duplicate type values across groups',
  new Set(allDefaults).size === allDefaults.length,
  allDefaults.filter((t, i) => allDefaults.indexOf(t) !== i).join(', '))
check('no type value contains parentheses (would break "Name (Typ)" keywords)',
  allDefaults.every((t) => isValidType(t)),
  allDefaults.filter((t) => !isValidType(t)).join(', '))
// Two SEPARATE systems now: didactic block roles vs. inline entity types.
// Didactic types must NOT be in the entity catalog (they'd otherwise land in
// cclom:general_keyword) — they live in DEFAULT_BLOCK_ROLES instead.
check('didactic types are NOT in the entity catalog',
  ['Definition', 'Beispiel', 'Aufgabe', 'Merksatz', 'Lernziel', 'Einleitung'].every((t) => !allDefaults.includes(t)))
check('level 2 entity types are present',
  ['Person', 'Organisation', 'Ort', 'Fachbegriff', 'Tool', 'Fehlermeldung'].every((t) => allDefaults.includes(t)))
check('topic hierarchy types are present',
  ['Thema', 'Themenbereich', 'Unterthema'].every((t) => allDefaults.includes(t)))

// --- block roles (paragraph structure, separate from entities) -----------------
check('block roles carry a slug + label and cover the didactic vocabulary',
  DEFAULT_BLOCK_ROLES.length >= 20
  && DEFAULT_BLOCK_ROLES.every((r) => r.slug && r.label)
  && ['Definition', 'Beispiel', 'Aufgabe', 'Merksatz', 'Einleitung'].every((l) => DEFAULT_BLOCK_ROLES.some((r) => r.label === l)))
check('roleSlug transliterates umlauts and is markdown-safe',
  roleSlug('Lösung') === 'loesung' && roleSlug('Übung') === 'uebung'
  && roleSlug('Definition') === 'definition' && /^[a-z0-9-]+$/.test(roleSlug('Rahmenkontext')))
check('block role slugs are unique',
  new Set(DEFAULT_BLOCK_ROLES.map((r) => r.slug)).size === DEFAULT_BLOCK_ROLES.length)
check('roleLabel resolves a slug back to its display label (de/en)',
  roleLabel('definition', 'de') === 'Definition' && roleLabel('definition', 'en') === 'Definition'
  && roleLabel('loesung', 'de') === 'Lösung' && roleLabel('loesung', 'en') === 'Solution')
check('roleLabel passes an unknown (free) slug through unchanged',
  roleLabel('mein-eigener', 'de') === 'mein-eigener' && roleLabel('mein-eigener', 'en') === 'mein-eigener')

// --- new role catalog (spec 07/2026, 112 roles) --------------------------------
check('role catalog has exactly the 112 specified roles', DEFAULT_BLOCK_ROLES.length === 112,
  `length=${DEFAULT_BLOCK_ROLES.length}`)
check('new roles are present',
  ['Überblick', 'Fazit', 'Eselsbrücke', 'Offene Frage', 'Interpretation der Ergebnisse', 'Quiz', 'Zeitstrahl', 'Klausurtipp']
    .every((l) => DEFAULT_BLOCK_ROLES.some((r) => r.label === l)))
check('retired roles are gone from the catalog',
  ['Lerninhalt', 'Rahmenkontext', 'Anekdote', 'Exkurs', 'Feedback', 'Kommentar']
    .every((l) => !DEFAULT_BLOCK_ROLES.some((r) => r.label === l)))
check('multi-word labels get hyphenated slugs and resolve back',
  roleLabel('offene-frage', 'de') === 'Offene Frage'
  && roleLabel('interpretation-der-ergebnisse', 'de') === 'Interpretation der Ergebnisse')
check('every role has a real English label (not the German fallback)',
  DEFAULT_BLOCK_ROLES.every((r) => {
    const en = roleLabel(r.slug, 'en')
    return typeof en === 'string' && en.length > 0
  })
  && roleLabel('eselsbruecke', 'en') === 'Mnemonic'
  && roleLabel('ueberblick', 'en') === 'Overview'
  && roleLabel('fazit', 'en') === 'Conclusion')

// --- suggestion builder ---------------------------------------------------------
const options = buildTypeOptions(['Person', 'Mein Spezialtyp'])
check('used custom types come first, marked as used',
  options[0].value === 'Mein Spezialtyp' && options[0].group === 'Bereits verwendet')
check('used default types are not duplicated',
  options.filter((o) => o.value === 'Person').length === 1)
check('all defaults are included with their group label',
  allDefaults.every((t) => options.some((o) => o.value === t && o.group)))
check('no used types → defaults only', buildTypeOptions([]).length === allDefaults.length)

// --- free-type validation (annotations.js) ---------------------------------------
check('free type without parentheses is valid', isValidType('Straßenname'))
check('type with parentheses is rejected', !isValidType('Methode (wissenschaftlich)'))
check('empty type is rejected', !isValidType('') && !isValidType('   '))

process.exit(fail ? 1 : 0)
