// Unit tests for the pure save-bar state logic (countdown, labels).
// Note: expected label values are German because they are user-facing UI text.
import { computeSaveBar } from '../src/save-state.js'

const NOW = 1_000_000
const base = {
  dirty: false, dirtySince: 0, lastChange: 0,
  lastSavedAt: null, saving: false, error: null,
  autosave: true, debounce: 15000, maxDebounce: 90000,
  canPersist: true,
}

const cases = [
  ['no write session → readonly', { ...base, canPersist: false, dirty: true },
    (r) => r.state === 'readonly' && r.label === 'wird nicht gespeichert'],
  ['saving → pending', { ...base, saving: true },
    (r) => r.state === 'pending' && r.label === 'speichere …'],
  ['error → error state with message in title', { ...base, error: 'kaputt' },
    (r) => r.state === 'error' && r.label === 'Speicherfehler' && r.title === 'kaputt'],
  ['dirty without autosave → off', { ...base, dirty: true, autosave: false },
    (r) => r.state === 'off' && r.label.includes('Auto-Speichern aus')],
  ['dirty → countdown from last change', { ...base, dirty: true, lastChange: NOW - 5000, dirtySince: NOW - 5000 },
    (r) => r.state === 'pending' && r.label === 'speichert in 10s'],
  ['dirty → maxDebounce caps the countdown', { ...base, dirty: true, lastChange: NOW - 1000, dirtySince: NOW - 89000 },
    (r) => r.state === 'pending' && r.label === 'speichert in 1s'],
  ['dirty, deadline passed → saving soon', { ...base, dirty: true, lastChange: NOW - 20000, dirtySince: NOW - 20000 },
    (r) => r.state === 'pending' && r.label === 'speichert gleich …'],
  ['clean with lastSavedAt → saved + time', { ...base, lastSavedAt: '2026-07-03T12:00:00.000Z' },
    (r) => r.state === 'saved' && /^gespeichert \d{2}:\d{2}$/.test(r.label)],
  ['clean without lastSavedAt → no changes', { ...base },
    (r) => r.state === 'saved' && r.label === 'keine Änderungen'],
]

let fail = 0
for (const [name, input, check] of cases) {
  const result = computeSaveBar(input, NOW)
  const ok = check(result)
  if (!ok) fail++
  console.log(ok ? 'OK   ' : 'FAIL ', name, ok ? '' : `→ ${JSON.stringify(result)}`)
}
process.exit(fail ? 1 : 0)
