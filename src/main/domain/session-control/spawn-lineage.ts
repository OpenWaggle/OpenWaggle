import type { SessionId } from '@shared/types/brand'

export interface ParentLineageSnapshot {
  readonly parentSessionId: SessionId
  readonly hiveRootSessionId?: SessionId
  readonly depth?: number
}

export interface ChildLineagePlan {
  readonly hiveRootSessionId: SessionId
  readonly depth: number
  readonly hiveRole: 'worker'
}

export function planChildLineage(parent: ParentLineageSnapshot): ChildLineagePlan {
  return {
    hiveRootSessionId: parent.hiveRootSessionId ?? parent.parentSessionId,
    depth: (parent.depth ?? 0) + 1,
    hiveRole: 'worker',
  }
}

export function classifyRootHiveRole(hasChildren: boolean): 'independent-root' | 'queen' {
  return hasChildren ? 'queen' : 'independent-root'
}
