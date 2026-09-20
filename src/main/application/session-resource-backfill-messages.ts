import type { Message } from '@shared/types/agent'
import type { SessionNode } from '@shared/types/session'

export interface ProjectedResourceMessage {
  readonly message: Message
  readonly nodeId: string
  readonly branchId: string | null
}

export function projectResourceMessages(input: {
  readonly messages?: readonly Message[]
  readonly nodes?: readonly SessionNode[]
}): readonly ProjectedResourceMessage[] {
  return input.nodes
    ? input.nodes.flatMap((node) =>
        node.message
          ? [
              {
                message: node.message,
                nodeId: String(node.id),
                branchId: node.branchId ?? null,
              },
            ]
          : [],
      )
    : (input.messages ?? []).map((message) => ({
        message,
        nodeId: String(message.id),
        branchId: null,
      }))
}
