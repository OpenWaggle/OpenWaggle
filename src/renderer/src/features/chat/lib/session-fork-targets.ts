import type { Message } from '@shared/types/agent'
import type { SessionNodeId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'

export interface SessionForkTarget {
  readonly entryId: SessionNodeId
  readonly text: string
}

function messageText(message: Message) {
  const chunks: string[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      chunks.push(part.text)
    }
  }
  return chunks.join('\n').trim()
}

export function getVisibleForkTargets(workspace: SessionWorkspace | null) {
  if (!workspace) {
    return [] satisfies readonly SessionForkTarget[]
  }

  const targets: SessionForkTarget[] = []
  for (const entry of workspace.transcriptPath) {
    const message = entry.node.message
    // The Host's Hive wake notice is not a message the user wrote, and Pi cannot fork there.
    if (entry.node.kind !== 'user_message' || message?.role !== 'user') continue
    if (entry.node.hiveWake || message.metadata?.hiveWake) continue

    const text = messageText(message)
    if (text) {
      targets.unshift({ entryId: entry.node.id, text })
    }
  }

  return targets
}
