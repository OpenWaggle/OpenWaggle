import type { SessionTreeNode } from '@shared/types/session'

export function sessionTreeNodeKey(node: SessionTreeNode) {
  return String(node.id)
}

export function sessionTreeParentKey(node: SessionTreeNode) {
  return node.parentId ? String(node.parentId) : null
}
