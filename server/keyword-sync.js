/**
 * Keyword synchronization helpers for the persistence layer (server/collab.js).
 *
 * Entity annotations are SEMANTIC STATEMENTS about the node's texts: an
 * entity keyword ("Name (Typ)") is only written while its quote is anchored
 * in the node's textbase, and annotations that are anchored nowhere are
 * pruned so no stale pill can falsify the statement.
 *
 * Anchoring ALWAYS runs against PLAIN text (markdownToPlainText) — the same
 * text the client's pills/decorations anchor against — never against the
 * markdown source, where bold marks split quotes and turndown escaping
 * (`snake\_case\_name`) breaks substring search (audit KW-1).
 */
import { findQuoteRange } from '../src/annotations.js'

/**
 * Transaction origin for the server-side prune: hocuspocus' skip-store
 * LocalTransactionOrigin — the prune runs right AFTER a verified save, so
 * scheduling another store cycle for it would only produce a noop-save
 * (audit L-2). collab.js' onChange also skips dirty-marking for this origin.
 */
export const PRUNE_ORIGIN = { source: 'local', skipStoreHooks: true }

/** Annotations whose quote is anchored in the (plain-text) textbase. */
export function anchoredAnnotations(document, plainTextbase) {
  return document.getArray('annotations').toArray()
    .filter((a) => findQuoteRange(plainTextbase, a.quote))
}

/**
 * Remove every annotation that is anchored nowhere in the textbase. Called
 * after a VERIFIED save (their keyword was just dropped from the repo);
 * callers pass the LIVE plain text so a quote restored (undo) during the
 * save keeps its pill. Returns the number of pruned annotations.
 */
export function pruneUnanchoredAnnotations(document, plainTextbase) {
  const arr = document.getArray('annotations')
  const stale = arr.toArray()
    .map((a, i) => ({ i, anchored: Boolean(findQuoteRange(plainTextbase, a.quote)) }))
    .filter((x) => !x.anchored)
  if (stale.length) {
    document.transact(() => {
      for (let k = stale.length - 1; k >= 0; k--) arr.delete(stale[k].i, 1)
    }, PRUNE_ORIGIN)
  }
  return stale.length
}
