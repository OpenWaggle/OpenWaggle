import { createHash } from 'node:crypto'

/**
 * The digest `session_nodes.content_hash` stores for a node's `content_json` and `metadata_json`,
 * so snapshot persistence can tell which of a Session's nodes changed without reading every
 * node's content back (D6). The content's length frames the two values, so no pair of strings
 * concatenates into another pair's digest.
 *
 * A stored hash is either null (written before the column existed, or by a writer that changed the
 * content without it: the `session_nodes_content_hash_guard` trigger clears it) or the digest of
 * the row's current values. Null always means "compare the content itself".
 */
export function sessionNodeContentHash(contentJson: string, metadataJson: string) {
  return createHash('sha256')
    .update(`${String(contentJson.length)}:`)
    .update(contentJson)
    .update(metadataJson)
    .digest('base64')
}
