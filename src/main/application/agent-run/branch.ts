import { SessionBranchId, type SessionId } from '@shared/types/brand'
import type { SessionTree } from '@shared/types/session'

const MAIN_BRANCH_NAME = 'main'

export function fallbackMainBranchId(sessionId: SessionId) {
  return SessionBranchId(`${sessionId}:${MAIN_BRANCH_NAME}`)
}

export function resolveActiveBranchId(sessionId: SessionId, tree: SessionTree | null) {
  return (
    tree?.session.lastActiveBranchId ??
    tree?.branches.find((branch) => branch.isMain)?.id ??
    fallbackMainBranchId(sessionId)
  )
}
