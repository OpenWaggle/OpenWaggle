import { useMemo } from 'react'
import { useSessionStore } from '@/features/sessions/state'
import {
  buildSessionResourceBranchNames,
  type SessionResourceBranchNames,
} from '../model/session-resource-browser'

const EMPTY_BRANCH_NAMES: SessionResourceBranchNames = new Map()

export function useSessionResourceBranchNames(sessionId: string | null) {
  const activeSessionTree = useSessionStore((state) => state.activeSessionTree)
  return useMemo(() => {
    if (!sessionId || !activeSessionTree || String(activeSessionTree.session.id) !== sessionId) {
      return EMPTY_BRANCH_NAMES
    }
    return buildSessionResourceBranchNames(activeSessionTree.branches)
  }, [activeSessionTree, sessionId])
}
