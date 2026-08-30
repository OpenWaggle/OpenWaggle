import type { Message } from '@shared/types/agent'
import type { SessionTree } from '@shared/types/session'

export interface PersistedRunResourceNodes {
  readonly resourceMessages: readonly Message[]
  readonly resourceNodeIds: Readonly<Record<string, string>>
  readonly resourceBranchIds: Readonly<Record<string, string | null>>
}

/**
 * Find the message-bearing nodes introduced by one snapshot persistence pass.
 * Resource provenance must use these stable transcript identities rather than
 * transient message ids returned by the runtime kernel.
 */
export function mapPersistedRunResourceNodes(
  existingTree: SessionTree | null,
  persistedTree: SessionTree | null,
): PersistedRunResourceNodes {
  const existingNodeIds = new Set((existingTree?.nodes ?? []).map((node) => String(node.id)))
  const resourceNodes = (persistedTree?.nodes ?? [])
    .filter((node) => !existingNodeIds.has(String(node.id)) && node.message !== undefined)
    .sort((left, right) => left.createdOrder - right.createdOrder)

  return {
    resourceMessages: resourceNodes.flatMap((node) => (node.message ? [node.message] : [])),
    resourceNodeIds: Object.fromEntries(
      resourceNodes.flatMap((node) =>
        node.message ? [[String(node.message.id), String(node.id)]] : [],
      ),
    ),
    resourceBranchIds: Object.fromEntries(
      resourceNodes.flatMap((node) =>
        node.message ? [[String(node.message.id), node.branchId ?? null]] : [],
      ),
    ),
  }
}
