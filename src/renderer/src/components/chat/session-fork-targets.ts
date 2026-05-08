import type { Message } from '@shared/types/agent'
import type { SessionNodeId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'

export interface SessionForkTarget {
  readonly entryId: SessionNodeId
  readonly text: string
}

function messageText(message: Message): string {
  const chunks: string[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      chunks.push(part.text)
    }
  }
  return chunks.join('\n').trim()
}

export function getVisibleForkTargets(
  workspace: SessionWorkspace | null,
): readonly SessionForkTarget[] {
  if (!workspace) {
    return []
  }

  const targets: SessionForkTarget[] = []
  for (const entry of workspace.transcriptPath) {
    const message = entry.node.message
    if (entry.node.kind !== 'user_message' || message?.role !== 'user') {
      continue
    }

    const text = messageText(message)
    if (text) {
      targets.unshift({ entryId: entry.node.id, text })
    }
  }

  return targets
}
