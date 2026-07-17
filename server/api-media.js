/**
 * Media + comment HTTP routes (extracted from server.js, audit M-3):
 * image upload as child-IO, node comments (list/add/delete). All write routes
 * share one spam-brake limiter and require a login session; edu-sharing
 * enforces the actual node permissions. Integration-tested over real HTTP in
 * test/api-auth.test.mjs.
 */
import express from 'express'
import { createRateLimiter, isValidNodeId } from './guards.js'
import { resolveAuthToken } from './sessions.js'
import { addComment, deleteComment, listComments } from './edu-sharing-api.js'
import { createImage, deleteImage, imageUrl, listEditorImages } from './images.js'

export function registerMediaRoutes(registerApp) {
  /** Raster image formats only (audit S-1): SVG can carry scripts and would be
   * served from the repository origin — never accept it. */
  const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

  /** Spam brake for logged-in users on the write routes (audit P-4). */
  const writeLimiter = createRateLimiter({ windowMs: 300000, max: 30 })
  function writeRateLimited(req, res) {
    if (writeLimiter(req.ip)) return false
    res.status(429).json({ error: 'Zu viele Schreibzugriffe — bitte kurz warten.' })
    return true
  }

  /** Image upload → child-IO under the node (login session required). The raw
   * image bytes come as the request body; edu-sharing enforces write access. */
  registerApp.post('/api/nodes/:id/images', express.raw({ type: 'image/*', limit: '10mb' }), async (req, res) => {
    if (!isValidNodeId(req.params.id)) return res.status(400).json({ error: 'Ungültige Node-ID' })
    const { authHeader } = resolveAuthToken(req.headers.authorization)
    if (!authHeader) return res.status(401).json({ error: 'Bild-Upload erfordert eine Anmeldung' })
    if (writeRateLimited(req, res)) return
    const mimetype = (req.headers['content-type'] || '').split(';')[0].trim()
    if (!ALLOWED_IMAGE_MIME.has(mimetype)) return res.status(415).json({ error: 'Nur Bilddateien (PNG, JPEG, WebP, GIF)' })
    if (!req.body?.length) return res.status(400).json({ error: 'Leerer Upload' })
    try {
      res.json(await createImage(req.params.id, String(req.query.filename || 'bild'), mimetype, req.body, authHeader))
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message })
    }
  })

  /** Editor images of a node (media panel) — a read; anonymous works where
   * the repository lets the caller read the node's children. */
  registerApp.get('/api/nodes/:id/images', async (req, res) => {
    if (!isValidNodeId(req.params.id)) return res.status(400).json({ error: 'Ungültige Node-ID' })
    const { authHeader } = resolveAuthToken(req.headers.authorization)
    try {
      const images = (await listEditorImages(req.params.id, authHeader || undefined))
        .map((n) => ({ imageId: n.ref?.id, name: n.name, url: imageUrl(n.ref?.id) }))
      res.json({ images })
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message })
    }
  })

  /** Delete ONE editor image (media panel). Guard: only mdimg- children of
   * THIS node are deletable through the route — never arbitrary nodes, even
   * with write access. */
  registerApp.delete('/api/nodes/:id/images/:imageId', async (req, res) => {
    if (!isValidNodeId(req.params.id) || !isValidNodeId(req.params.imageId)) {
      return res.status(400).json({ error: 'Ungültige Node-ID' })
    }
    const { authHeader } = resolveAuthToken(req.headers.authorization)
    if (!authHeader) return res.status(401).json({ error: 'Löschen erfordert eine Anmeldung' })
    if (writeRateLimited(req, res)) return
    try {
      const editorImages = await listEditorImages(req.params.id, authHeader)
      if (!editorImages.some((n) => n.ref?.id === req.params.imageId)) {
        return res.status(404).json({ error: 'Kein Editor-Bild dieses Knotens' })
      }
      await deleteImage(req.params.imageId, authHeader)
      res.sendStatus(204)
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message })
    }
  })

  /** Node comments (edu-sharing comment API, proxied with the user's session). */
  registerApp.get('/api/nodes/:id/comments', async (req, res) => {
    if (!isValidNodeId(req.params.id)) return res.status(400).json({ error: 'Ungültige Node-ID' })
    const { authHeader, session } = resolveAuthToken(req.headers.authorization)
    try {
      res.json({ comments: await listComments(req.params.id, authHeader || undefined, session?.authorityName || null) })
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message })
    }
  })

  registerApp.post('/api/nodes/:id/comments', async (req, res) => {
    if (!isValidNodeId(req.params.id)) return res.status(400).json({ error: 'Ungültige Node-ID' })
    const { authHeader } = resolveAuthToken(req.headers.authorization)
    if (!authHeader) return res.status(401).json({ error: 'Kommentieren erfordert eine Anmeldung' })
    if (writeRateLimited(req, res)) return
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    const replyTo = typeof req.body?.replyTo === 'string' ? req.body.replyTo : null
    if (!text || text.length > 4000) return res.status(400).json({ error: 'Kommentartext fehlt oder ist zu lang (max. 4000 Zeichen)' })
    try {
      await addComment(req.params.id, text, authHeader, replyTo)
      res.sendStatus(204)
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message })
    }
  })

  registerApp.delete('/api/comments/:commentId', async (req, res) => {
    if (!isValidNodeId(req.params.commentId)) return res.status(400).json({ error: 'Ungültige Kommentar-ID' })
    const { authHeader } = resolveAuthToken(req.headers.authorization)
    if (!authHeader) return res.status(401).json({ error: 'Löschen erfordert eine Anmeldung' })
    if (writeRateLimited(req, res)) return
    try {
      await deleteComment(req.params.commentId, authHeader)
      res.sendStatus(204)
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message })
    }
  })
}
