// Unit tests for the i18n message catalog + entity-type translation maps.
// Guards against silent regressions: missing keys must fall back cleanly,
// and both language dictionaries / the type catalog must stay in sync.
import { t, LANGS, DEFAULT_LANG, messageKeys } from '../src/i18n.js'
import { DEFAULT_TYPE_GROUPS, TYPE_LABELS_EN, GROUP_LABELS_EN, typeLabel, groupLabel, buildTypeOptions } from '../src/entity-types.js'

// Full de/en key-set parity (audit T-2): a key present in one language but
// missing in the other would silently fall back to the raw dot-path string
// in production (see t()'s fallback chain) instead of failing loudly here.
const deKeys = new Set(messageKeys('de'))
const enKeys = new Set(messageKeys('en'))
const missingInEn = [...deKeys].filter((k) => !enKeys.has(k))
const missingInDe = [...enKeys].filter((k) => !deKeys.has(k))

const SAMPLE_KEYS = [
  'toolbar.bold', 'toolbar.linkPrompt', 'editor.placeholder', 'editor.tagButtonLabel',
  'saveBar.saving', 'saveBar.saved', 'tag.typeLabel', 'tag.typeRequiredError',
  'manage.title', 'chips.orphanTitle', 'controller.crossing', 'host.loginChecking',
  'host.pendingAutosave', 'app.title', 'open.hint', 'editorEmpty.text',
  // Visible toolbar button LABELS (not just tooltips) — regression guard for
  // the "⊞ Tabelle shown in English UI" bug: text-bearing labels must be keys
  'toolbar.tableLabel', 'toolbar.bulletListLabel', 'toolbar.rowAddLabel',
  // Save-target label is composed client-side (server strings stay German)
  'host.targetCompendiumLabel', 'host.targetDescriptionLabel',
]

const cases = []

for (const lang of LANGS) {
  for (const key of SAMPLE_KEYS) {
    cases.push([`${lang}: ${key} resolves to a non-empty, non-key string`, () => {
      const msg = t(lang, key)
      return typeof msg === 'string' && msg.length > 0 && msg !== key
    }])
  }
}

cases.push(['unknown key falls back to the raw key (never breaks the UI)', () => {
  return t('en', 'does.not.exist') === 'does.not.exist'
}])

cases.push(['unknown language falls back to DEFAULT_LANG', () => {
  return t('fr', 'toolbar.bold') === t(DEFAULT_LANG, 'toolbar.bold')
}])

cases.push(['placeholder substitution replaces {vars}', () => {
  return t('en', 'saveBar.pendingCountdown', { secs: 7 }) === 'saving in 7s'
}])

cases.push(['English table label is actually English (not "Tabelle")', () => {
  return t('en', 'toolbar.tableLabel').includes('Table') && !t('en', 'toolbar.tableLabel').includes('Tabelle')
}])

cases.push(['every DE key has an EN counterpart', () => missingInEn.length === 0, missingInEn])
cases.push(['every EN key has a DE counterpart', () => missingInDe.length === 0, missingInDe])
cases.push(['both dictionaries are non-empty', () => deKeys.size > 0 && enKeys.size > 0])

// Entity-type catalog: every default VALUE and GROUP label must have an EN
// translation entry, and the canonical (German) value must stay unaffected
// by the display language (persisted keyword compatibility).
const allTypes = DEFAULT_TYPE_GROUPS.flatMap((g) => g.types)
const allGroups = DEFAULT_TYPE_GROUPS.map((g) => g.label)

cases.push(['every default type has an English label', () => {
  return allTypes.every((v) => Boolean(TYPE_LABELS_EN[v]))
}])

cases.push(['every default group has an English label', () => {
  return allGroups.every((g) => Boolean(GROUP_LABELS_EN[g]))
}])

cases.push(['typeLabel/groupLabel: German stays unchanged', () => {
  return typeLabel('Ort', 'de') === 'Ort' && groupLabel('Personen, Institutionen, Orte', 'de') === 'Personen, Institutionen, Orte'
}])

cases.push(['typeLabel: English translates known types, passes through unknown ones', () => {
  return typeLabel('Ort', 'en') === 'Place' && typeLabel('Mein Spezialtyp', 'en') === 'Mein Spezialtyp'
}])

cases.push(['buildTypeOptions: value is always the canonical German value, label follows lang', () => {
  const de = buildTypeOptions([], 'de').find((o) => o.value === 'Ort')
  const en = buildTypeOptions([], 'en').find((o) => o.value === 'Ort')
  return de.label === 'Ort' && en.label === 'Place' && de.value === en.value
}])

let fail = 0
for (const [name, check, extra] of cases) {
  const ok = check()
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok || !extra ? '' : `→ ${JSON.stringify(extra)}`)
}
process.exit(fail ? 1 : 0)
