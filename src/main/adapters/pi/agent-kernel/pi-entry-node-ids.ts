import type { SessionDetail } from '@shared/types/session'

/**
 * How a Session's projected node ids relate to its Pi entry ids.
 *
 * A Session's nodes normally use its Pi entry ids unchanged. OpenWaggle stores every Session's
 * nodes under one global key (ADR 0041), and a Pi session created outside OpenWaggle may have
 * copied its entry ids from another one: the `pi` CLI's `/fork` keeps the source's ids. A
 * discovered Pi session therefore projects its entries under a per-Session prefix (ADR 0050), so
 * its nodes can never collide with another Session's, and OpenWaggle never rewrites the file. Every
 * id that crosses between the projection and Pi passes through this mapping.
 */
export interface PiEntryNodeIds {
  readonly toNodeId: (entryId: string) => string
  readonly toEntryId: (nodeId: string) => string
}

const UNCHANGED: PiEntryNodeIds = {
  toNodeId: (entryId) => entryId,
  toEntryId: (nodeId) => nodeId,
}

export function piEntryNodeIdsWithPrefix(prefix: string | undefined): PiEntryNodeIds {
  if (!prefix) return UNCHANGED
  return {
    toNodeId: (entryId) => `${prefix}${entryId}`,
    // An id without the prefix, such as an OpenWaggle agent-loop node, is not a Pi entry.
    toEntryId: (nodeId) => (nodeId.startsWith(prefix) ? nodeId.slice(prefix.length) : nodeId),
  }
}

export function piEntryNodeIds(session: Pick<SessionDetail, 'piEntryNodeIdPrefix'>) {
  return piEntryNodeIdsWithPrefix(session.piEntryNodeIdPrefix)
}
