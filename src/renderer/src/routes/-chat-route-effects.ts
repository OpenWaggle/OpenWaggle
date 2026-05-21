import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useBranchSummaryStore, useChatStore } from '@/features/chat/state'
import { useGitStore } from '@/features/git/state'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'

interface ChatRouteEffectsParams {
  readonly branchId: string | null
  readonly diffOpen: boolean
  readonly nodeId: string | null
  readonly sessionId: string | null
}

function sessionIdFromRoute(sessionId: string) {
  return SessionId(sessionId)
}

export function useChatRouteEffects({
  branchId,
  diffOpen,
  nodeId,
  sessionId,
}: ChatRouteEffectsParams) {
  const navigate = useNavigate()
  const routeSessionId = sessionId ? sessionIdFromRoute(sessionId) : null
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const activeSession = useChatStore((state) => state.activeSession)
  const draftSession = useChatStore((state) => state.draftSession)
  const setActiveSession = useChatStore((state) => state.setActiveSession)
  const routeSessionDetail = useChatStore((state) =>
    routeSessionId === null ? null : (state.sessionById.get(routeSessionId) ?? null),
  )
  const routeSessionMissing = useChatStore((state) =>
    routeSessionId === null ? false : state.missingSessionIds.has(routeSessionId),
  )
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const setProjectPath = usePreferencesStore((state) => state.setProjectPath)
  const refreshGitStatus = useGitStore((state) => state.refreshStatus)
  const refreshGitBranches = useGitStore((state) => state.refreshBranches)
  const refreshSessionWorkspace = useSessionStore((state) => state.refreshSessionWorkspace)
  const draftBranch = useSessionStore((state) => state.draftBranch)
  const clearDraftBranchForSession = useSessionStore((state) => state.clearDraftBranchForSession)

  useEffect(() => {
    if (routeSessionId === null) {
      if (draftSession === null && activeSessionId !== null && activeSession !== null) {
        void navigate({
          to: '/sessions/$sessionId',
          params: { sessionId: String(activeSessionId) },
          replace: true,
          search: diffOpen ? { diff: 1 } : {},
        })
      }
      return
    }

    if (draftSession !== null) {
      void navigate({ to: '/', replace: true })
      return
    }

    if (routeSessionMissing) {
      setActiveSession(null)
      void navigate({ to: '/', replace: true })
      return
    }

    if (activeSessionId !== routeSessionId) {
      setActiveSession(routeSessionId)
    }
    useSessionStatusStore.getState().markVisited(routeSessionId)
  }, [
    activeSession,
    activeSessionId,
    diffOpen,
    draftSession,
    navigate,
    routeSessionId,
    routeSessionMissing,
    setActiveSession,
  ])

  const routeSessionTreeId = routeSessionId ? SessionId(String(routeSessionId)) : null
  const routeBranchId = branchId ? SessionBranchId(branchId) : null
  const routeNodeId = nodeId ? SessionNodeId(nodeId) : null

  useEffect(() => {
    if (
      draftBranch &&
      (routeSessionTreeId === null || draftBranch.sessionId !== routeSessionTreeId || routeBranchId)
    ) {
      useBranchSummaryStore.getState().clearPrompt()
      clearDraftBranchForSession(draftBranch.sessionId)
    }
  }, [clearDraftBranchForSession, draftBranch, routeBranchId, routeSessionTreeId])

  useEffect(() => {
    void refreshSessionWorkspace(routeSessionTreeId, {
      branchId: routeBranchId,
      nodeId: routeNodeId,
    })
  }, [refreshSessionWorkspace, routeBranchId, routeNodeId, routeSessionTreeId])

  const routeProjectPath = routeSessionDetail?.projectPath ?? null
  const nextProjectPath = draftSession?.projectPath ?? routeProjectPath ?? projectPath

  useEffect(() => {
    if (draftSession === null && routeProjectPath !== null && routeProjectPath !== projectPath) {
      void setProjectPath(routeProjectPath)
    }
  }, [draftSession, projectPath, routeProjectPath, setProjectPath])

  useEffect(() => {
    void refreshGitStatus(nextProjectPath)
    void refreshGitBranches(nextProjectPath)
  }, [nextProjectPath, refreshGitBranches, refreshGitStatus])
}
