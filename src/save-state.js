/**
 * Pure save-bar state logic: derives display state, label and tooltip from
 * the component's save state. No DOM — unit-testable in isolation.
 */

/**
 * @param {object} s Component save state:
 *   {dirty, dirtySince, lastChange, lastSavedAt, saving, error,
 *    autosave, debounce, maxDebounce, canPersist}
 * @param {number} [now] Timestamp (ms) — injectable for tests
 * @returns {{state: string, label: string, title: string, canSaveNow: boolean}}
 */
export function computeSaveBar(s, now = Date.now()) {
  // Every branch below assigns state + label; only title has a default
  let state, label, title = ''
  if (!s.canPersist) {
    state = 'readonly'
    label = 'wird nicht gespeichert'
    title = 'Keine Schreib-Session am Server (Anmeldung/Schreibrecht nötig)'
  } else if (s.saving) {
    state = 'pending'
    label = 'speichere …'
  } else if (s.error) {
    state = 'error'
    label = 'Speicherfehler'
    title = s.error
  } else if (s.dirty && !s.autosave) {
    state = 'off'
    label = 'ungespeichert · Auto-Speichern aus'
  } else if (s.dirty) {
    const next = Math.min(s.lastChange + s.debounce, s.dirtySince + s.maxDebounce)
    const secs = Math.max(0, Math.ceil((next - now) / 1000))
    state = 'pending'
    label = secs > 0 ? `speichert in ${secs}s` : 'speichert gleich …'
  } else if (s.lastSavedAt) {
    state = 'saved'
    label = `gespeichert ${new Date(s.lastSavedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
  } else {
    state = 'saved'
    label = 'keine Änderungen'
  }
  return { state, label, title, canSaveNow: Boolean(s.canPersist && s.dirty && !s.saving) }
}
