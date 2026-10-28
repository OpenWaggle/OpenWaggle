import type { SessionTreeNode } from '@shared/types/session'

export function sessionTreeNodeLabel(node: SessionTreeNode) {
  // The tree carries the start of each message's text rather than the message (B5).
  const text = node.preview?.replace(/\s+/g, ' ').trim()
  if (text) {
    return text
  }

  return node.kind.replace(/_/g, ' ')
}

export function sessionTreeNodeRoleLabel(node: SessionTreeNode) {
  if (node.kind === 'user_message') return 'User'
  if (node.kind === 'assistant_message') return 'Assistant'
  if (node.kind === 'tool_result') return 'Tool'
  if (node.kind === 'branch_summary') return 'Branch summary'
  if (node.kind === 'compaction_summary') return 'Compaction'
  return node.kind.replace(/_/g, ' ')
}
