import type { SessionNode } from '@shared/types/session'

export function sessionTreeNodeKey(node: SessionNode) {
  return String(node.id)
}

export function sessionTreeParentKey(node: SessionNode) {
  return node.parentId ? String(node.parentId) : null
}
