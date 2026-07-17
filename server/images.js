/**
 * Editor images as edu-sharing SERIES OBJECTS (child-IOs): each uploaded
 * image becomes a `ccm:io` child under the compendium node (assocType
 * ccm:childio + aspect ccm:io_childobject — validated pattern, write access
 * on the parent suffices, children are deleted with the parent). The saved
 * markdown embeds the repository's stable download URL, so the images render
 * everywhere the node is readable.
 *
 * All editor-managed children carry the `mdimg-` name prefix — the orphan
 * cleanup (media housekeeping on every verified save) deletes ONLY children
 * with this prefix whose id no longer appears in the markdown. Foreign
 * attachments are never touched.
 */
import { EDU_BASE } from './config.js'
import { eduFetch } from './edu-sharing-api.js'

const PREFIX = 'mdimg-'

/** Stable (non-expiring) repository download URL for an image child. */
export function imageUrl(imageId) {
  return `${EDU_BASE}/edu-sharing/eduservlet/download?nodeId=${imageId}`
}

/** Create the child-IO and upload the image bytes. Returns {imageId, url}. */
export async function createImage(parentId, filename, mimetype, bytes, auth) {
  const baseName = (filename || '').replace(/[^\w.\-äöüÄÖÜß ]+/g, '') || 'bild'
  const safeName = PREFIX + baseName
  const params = new URLSearchParams({
    type: 'ccm:io', renameIfExists: 'true', assocType: 'ccm:childio',
    versionComment: 'md-editor image', aspects: 'ccm:io_childobject',
  })
  const createdNode = await eduFetch(`/node/v1/nodes/-home-/${parentId}/children/?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'cm:name': [safeName] }),
    auth,
  })
  const imageId = createdNode?.node?.ref?.id
  if (!imageId) throw new Error('edu-sharing hat kein Child-IO angelegt')
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: mimetype }), safeName)
  await eduFetch(`/node/v1/nodes/-home-/${imageId}/content?mimetype=${encodeURIComponent(mimetype)}&versionComment=Initial`, {
    method: 'POST', body: form, auth,
  })
  await mirrorPublicRead(parentId, imageId, auth)
  return { imageId, url: imageUrl(imageId) }
}

/**
 * Mirror the PARENT's anonymous readability onto a fresh image child: the
 * markdown embeds the repo download URL, which browsers fetch WITHOUT an
 * edu-sharing session — inheritance alone is not enough for the download/
 * preview servlets (they require an explicit GROUP_EVERYONE Consumer, see
 * the documented preview-permission quirk). On a restricted parent the image
 * deliberately stays restricted too. Best effort: a failure must not break
 * the upload (the image still works for logged-in repository sessions).
 */
async function mirrorPublicRead(parentId, imageId, auth) {
  try {
    // auth: null = explicitly anonymous (no service-account fallback)
    await eduFetch(`/node/v1/nodes/-home-/${parentId}/metadata?propertyFilter=-all-`, { auth: null })
  } catch {
    return false // parent not anonymously readable → keep the image restricted
  }
  try {
    // POST replaces only the LOCAL ACL — empty on a fresh child; inheritance stays on
    await eduFetch(`/node/v1/nodes/-home-/${imageId}/permissions?sendMail=false&sendCopy=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inherited: true,
        permissions: [{
          authority: { authorityName: 'GROUP_EVERYONE', authorityType: 'EVERYONE' },
          permissions: ['Consumer'],
        }],
      }),
      auth,
    })
    return true
  } catch (err) {
    console.error(`[images] public-read mirror ${imageId}: ${err.message}`)
    return false
  }
}

/** Delete one editor image node (media panel + orphan cleanup). */
export async function deleteImage(imageId, auth) {
  await eduFetch(`/node/v1/nodes/-home-/${imageId}`, { method: 'DELETE', auth })
}

/** All editor-managed image children (mdimg- prefix) of a node. */
export async function listEditorImages(parentId, auth) {
  const data = await eduFetch(`/node/v1/nodes/-home-/${parentId}/children?propertyFilter=-all-`, { auth })
  return (data?.nodes || []).filter((n) =>
    (n.aspects || []).includes('ccm:io_childobject') && (n.name || '').startsWith(PREFIX))
}

/**
 * Media housekeeping after a verified save: delete every editor-managed image
 * whose node id no longer appears in the persisted markdown. Returns the
 * number removed; failures are logged, never thrown (a save must not break
 * on cleanup).
 */
export async function cleanupOrphanImages(parentId, markdown, auth) {
  let removed = 0
  try {
    for (const img of await listEditorImages(parentId, auth)) {
      const id = img.ref?.id
      if (!id || markdown.includes(id)) continue
      await deleteImage(id, auth)
      removed++
    }
  } catch (err) {
    console.error(`[images] cleanup ${parentId}: ${err.message}`)
  }
  if (removed) console.log(`[images] ${parentId}: removed ${removed} orphaned image(s)`)
  return removed
}
