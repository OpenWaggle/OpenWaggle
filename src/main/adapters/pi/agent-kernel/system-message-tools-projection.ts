import { createHash } from 'node:crypto'
import { toJsonValue } from '../pi-message-mapper'

/**
 * A system message's tools by name, with a digest of their full definitions. Pi writes every
 * tool's complete schema into each Run's system message; the projection kept them all, 55 KB a
 * Run on average and 200 MB of a 1.2 GB profile's node content, and nothing reads them from the
 * projection: the Pi file stays the source of each definition (ADR 0051). The digest still tells
 * two tool sets apart.
 */
export function systemMessageTools(tools: readonly { readonly name: string }[]) {
  return {
    toolsAdded: tools.map((tool) => ({ name: tool.name })),
    toolsAddedDigest:
      tools.length === 0
        ? null
        : createHash('sha256')
            .update(JSON.stringify(toJsonValue(tools)))
            .digest('hex'),
  }
}
