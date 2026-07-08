// Unit tests for the default entity-type catalog and the suggestion builder
// (defaults grouped, already-used custom types merged in, free types allowed).
import { DEFAULT_TYPE_GROUPS, buildTypeOptions } from '../src/entity-types.js'
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
check('level 1 didactic types are present',
  ['Definition', 'Beispiel', 'Aufgabe', 'Merksatz', 'Lernziel'].every((t) => allDefaults.includes(t)))
check('level 2 entity types are present',
  ['Person', 'Organisation', 'Ort', 'Fachbegriff', 'Tool', 'Fehlermeldung'].every((t) => allDefaults.includes(t)))

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
