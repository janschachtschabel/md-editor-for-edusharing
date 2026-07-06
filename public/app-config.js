/**
 * Runtime configuration of the demo host page.
 *
 * backendBase: '' means the collab server runs on the same origin as this
 * page (all-in-one Docker deployment — the standard setup). Only set an
 * absolute URL if this page (or a later embedding, e.g. inside edu-sharing)
 * is served from a different origin than the collab server:
 *   window.APP_CONFIG = { backendBase: 'https://collab.example.org' }
 * The server must then allow that origin via ALLOWED_ORIGINS.
 */
window.APP_CONFIG = { backendBase: '' }
