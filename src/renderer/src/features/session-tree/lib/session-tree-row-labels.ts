import { getMessageText } from '@shared/types/agent'
import type { SessionNode } from '@shared/types/session'

export function sessionTreeNodeLabel(node: SessionNode) {
  if (node.message) {
    const text = getMessageText(node.message).replace(/\s+/g, ' ').trim()
    if (text) {
      return text
    }
  }

  return node.kind.replace(/_/g, ' ')
}

export function sessionTreeNodeRoleLabel(node: SessionNode) {
  if (node.kind === 'user_message') return 'User'
  if (node.kind === 'assistant_message') return 'Assistant'
  if (node.kind === 'tool_result') return 'Tool'
  if (node.kind === 'branch_summary') return 'Branch summary'
  if (node.kind === 'compaction_summary') return 'Compaction'
  return node.kind.replace(/_/g, ' ')
}
