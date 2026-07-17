/**
 * Presence feature for <md-collab-editor>: tracks who is connected via the
 * Hocuspocus awareness states, derives per-user activity ("currently typing")
 * from cursor movement, renders the presence chips and reports the user list
 * to the component (which emits its public `users-change` event).
 *
 * Extracted from the web component (audit F-T5) — same pattern as
 * AnnotationController: the component wires DOM + events, features live in
 * their own modules.
 */
import { t } from './i18n.js'

/** A user counts as "active" while their cursor moved within this window. */
const ACTIVITY_MS = 4000
/** Activity fades out over time — re-emit at this cadence. */
const REFRESH_MS = 2000

export class PresenceTracker {
  constructor({ provider, usersEl, getLang, onUsers, onJumpTo }) {
    this.provider = provider
    this.usersEl = usersEl
    this.getLang = getLang || (() => 'de')
    this.onUsers = onUsers || (() => {})
    this.onJumpTo = onJumpTo || null
    this._cursors = new Map() // clientId → serialized cursor position
    this._active = new Map()  // clientId → timestamp of last activity
    this._states = []
    provider.on('awarenessUpdate', ({ states }) => this._update(states))
    this._interval = setInterval(() => this._emit(), REFRESH_MS)
  }

  dispose() {
    clearInterval(this._interval)
  }

  /** Awareness changed: a moving cursor marks its user as active. */
  _update(states) {
    const now = Date.now()
    for (const s of states) {
      if (!s.user) continue
      const cur = JSON.stringify(s.cursor ?? null)
      const prev = this._cursors.get(s.clientId)
      if (prev !== undefined && prev !== cur) this._active.set(s.clientId, now)
      this._cursors.set(s.clientId, cur)
    }
    this._states = states
    this._emit()
  }

  _emit() {
    const now = Date.now()
    const self = this.provider?.document?.clientID
    const users = this._states
      .filter((s) => s.user)
      .map((s) => ({
        name: s.user.name,
        color: s.user.color,
        clientId: s.clientId,
        isSelf: s.clientId === self,
        active: now - (this._active.get(s.clientId) || 0) < ACTIVITY_MS,
      }))
    this._render(users)
    this.onUsers(users)
  }

  /** Presence chips (right side of the toolbar). */
  _render(users) {
    if (!this.usersEl) return
    const lang = this.getLang()
    this.usersEl.innerHTML = ''
    for (const u of users) {
      // Other users' chips jump to their cursor on click
      const jumpable = Boolean(this.onJumpTo) && !u.isSelf
      const chip = document.createElement(jumpable ? 'button' : 'span')
      if (jumpable) {
        chip.type = 'button'
        chip.addEventListener('click', () => this.onJumpTo(u.clientId))
      }
      chip.className = 'mce-chip' + (u.active ? ' mce-chip-active' : '')
      chip.style.background = u.color || '#888'
      chip.textContent = (u.name || '?') + (u.isSelf ? t(lang, 'users.self') : '') + (u.active && !u.isSelf ? ' ✎' : '')
      const stateTitle = u.active ? t(lang, 'users.editingTitle', { name: u.name }) : t(lang, 'users.connectedTitle', { name: u.name })
      chip.title = jumpable ? `${stateTitle} — ${t(lang, 'users.jumpTitle')}` : stateTitle
      this.usersEl.appendChild(chip)
    }
  }
}
