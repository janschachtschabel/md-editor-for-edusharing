/**
 * Save bar for <md-collab-editor>: status LED, countdown/time text and the
 * manual "Speichern" button. Owns the client-side save STATE (dirty/saving/
 * error/…); the pure display logic lives in save-state.js (computeSaveBar).
 * The server remains authoritative — its 'config'/'saved'/'save-error'
 * broadcasts arrive via applyServerEvent(). Extracted from the web component
 * following the AnnotationController / PresenceTracker / RoleUi pattern.
 */
import { computeSaveBar } from './save-state.js'
import { t } from './i18n.js'

export class SaveBarUi {
  /**
   * @param {object} deps
   * @param {() => string} deps.getLang UI language ('de'|'en')
   * @param {() => void} deps.sendSave sends the stateless "save" command
   * @param {(state: object) => void} deps.onStateChange save-state-change hook
   */
  constructor({ getLang, sendSave, onStateChange }) {
    this.getLang = getLang
    this.sendSave = sendSave
    this.onStateChange = onStateChange
    // dirty/lastChange observed locally (every client sees all Yjs changes),
    // save results arrive as broadcasts from the server
    this.state = {
      dirty: false, dirtySince: 0, lastChange: 0,
      lastSavedAt: null, saving: false, error: null,
      autosave: true, debounce: 15000, maxDebounce: 90000,
      canPersist: false, synced: false,
    }
    this.el = null
    this._ticker = null
    this._timeout = null
  }

  /** Build the bar element and start the countdown ticker (caller appends). */
  build() {
    const lang = this.getLang()
    this.el = document.createElement('span')
    this.el.className = 'mce-savebar'
    this.el.setAttribute('part', 'savebar')
    this.el.innerHTML = `
      <span class="mce-save-dot" data-state="idle" aria-hidden="true"></span>
      <span class="mce-save-text" role="status" aria-live="polite">–</span>
      <button type="button" class="mce-save-btn" disabled>${t(lang, 'editor.saveButton')}</button>
    `
    this.el.querySelector('.mce-save-btn').addEventListener('click', () => {
      const s = this.state
      if (!s.dirty || s.saving) return
      s.saving = true
      this.render()
      this.sendSave()
      // Safety net: if the server never answers (connection drop), don't leave
      // the button stuck on "Speichere …" forever (audit L-01)
      clearTimeout(this._timeout)
      this._timeout = setTimeout(() => {
        if (s.saving) {
          s.saving = false
          s.error = t(this.getLang(), 'editor.saveTimeoutError')
          this.render()
        }
      }, 20000)
    })
    // Only the dirty-state countdown changes with time; every other save-bar
    // transition re-renders explicitly — skip idle ticks (audit 6, P-3)
    this._ticker = setInterval(() => { if (this.state.dirty) this.render() }, 1000)
    return this.el
  }

  /** Initial server synchronization finished — start tracking changes. */
  markSynced() {
    this.state.synced = true
  }

  /** A document change (own or remote edit, tag change) → dirty + countdown.
   * Ignored before the initial sync so preloading does not count as a change. */
  noteChange() {
    const s = this.state
    if (!s.synced) return
    const now = Date.now()
    if (!s.dirty) s.dirtySince = now
    s.dirty = true
    s.lastChange = now
    this.render()
  }

  /**
   * Server broadcasts that carry save state ('config' | 'saved' |
   * 'save-error') → update state, render, notify the host. Other events are
   * the component's business and must not reach this method.
   */
  applyServerEvent(msg) {
    const s = this.state
    if (msg.event === 'config') {
      s.debounce = msg.saveDebounceMs ?? s.debounce
      s.maxDebounce = msg.saveMaxDebounceMs ?? s.maxDebounce
      s.autosave = msg.autosave ?? s.autosave
      s.canPersist = msg.canPersist ?? s.canPersist
      s.lastSavedAt = msg.lastSavedAt ?? s.lastSavedAt
      if (msg.dirty && !s.dirty) { s.dirty = true; s.dirtySince = Date.now(); s.lastChange = Date.now() }
      if (msg.dirty === false) s.dirty = false
    } else if (msg.event === 'saved') {
      clearTimeout(this._timeout)
      s.dirty = false
      s.saving = false
      s.error = null
      if (msg.at) s.lastSavedAt = msg.at
    } else if (msg.event === 'save-error') {
      clearTimeout(this._timeout)
      s.saving = false
      s.error = msg.message || t(this.getLang(), 'editor.saveFailedFallback')
    }
    this.render()
    this.onStateChange({ ...s })
  }

  render() {
    if (!this.el) return
    const { state, label, title, canSaveNow } = computeSaveBar(this.state, Date.now(), this.getLang())
    this.el.querySelector('.mce-save-dot').dataset.state = state
    const text = this.el.querySelector('.mce-save-text')
    text.textContent = label
    text.title = title
    this.el.querySelector('.mce-save-btn').disabled = !canSaveNow
  }

  dispose() {
    clearInterval(this._ticker)
    clearTimeout(this._timeout)
  }
}
