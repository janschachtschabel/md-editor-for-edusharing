/**
 * Pure save-bar state logic: derives display state, label and tooltip from
 * the component's save state. No DOM — unit-testable in isolation.
 */
import { t } from './i18n.js'

/**
 * @param {object} s Component save state:
 *   {dirty, dirtySince, lastChange, lastSavedAt, saving, error,
 *    autosave, debounce, maxDebounce, canPersist}
 * @param {number} [now] Timestamp (ms) — injectable for tests
 * @param {string} [lang] UI language ('de'|'en'), default 'de' (also the
 *   language the existing tests assert against — see test/save-state.test.mjs)
 * @returns {{state: string, label: string, title: string, canSaveNow: boolean}}
 */
export function computeSaveBar(s, now = Date.now(), lang = 'de') {
  // Every branch below assigns state + label; only title has a default
  let state, label, title = ''
  if (!s.canPersist) {
    state = 'readonly'
    label = t(lang, 'saveBar.readonly')
    title = t(lang, 'saveBar.readonlyTitle')
  } else if (s.saving) {
    state = 'pending'
    label = t(lang, 'saveBar.saving')
  } else if (s.error) {
    state = 'error'
    label = t(lang, 'saveBar.error')
    title = s.error
  } else if (s.dirty && !s.autosave) {
    state = 'off'
    label = t(lang, 'saveBar.offlineDirty')
  } else if (s.dirty) {
    const next = Math.min(s.lastChange + s.debounce, s.dirtySince + s.maxDebounce)
    const secs = Math.max(0, Math.ceil((next - now) / 1000))
    state = 'pending'
    label = secs > 0 ? t(lang, 'saveBar.pendingCountdown', { secs }) : t(lang, 'saveBar.pendingNow')
  } else if (s.lastSavedAt) {
    state = 'saved'
    const time = new Date(s.lastSavedAt).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' })
    label = t(lang, 'saveBar.saved', { time })
  } else {
    state = 'saved'
    label = t(lang, 'saveBar.noChanges')
  }
  return { state, label, title, canSaveNow: Boolean(s.canPersist && s.dirty && !s.saving) }
}
