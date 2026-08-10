import type { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode, VcsChangeRequest } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  resolveDefaultWorktreeBaseRef,
  resolveWorktreeSendPlan,
  type WorktreeSendPlan,
} from '@/features/git/lib/worktree-send-plan'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('composer-context-strip')

interface UseComposerContextStripInput {
  readonly sessionId: SessionId | null
  readonly projectPath: string | null
  readonly isFirstMessage: boolean
  readonly session: Pick<
    SessionDetail,
    'environmentMode' | 'worktreePath' | 'worktreeBaseRef' | 'worktreeStartFromOrigin'
  > | null
  readonly defaultEnvironmentMode: SessionEnvironmentMode
}

export interface ComposerContextStripState {
  readonly visible: boolean
  readonly envMode: SessionEnvironmentMode
  readonly baseRef: string | null
  readonly startFromOrigin: boolean
  readonly branchNames: readonly string[]
  readonly changeRequests: readonly VcsChangeRequest[]
  readonly sendPlan: WorktreeSendPlan
  readonly setEnvMode: (mode: SessionEnvironmentMode) => void
  readonly setBaseRef: (baseRef: string) => void
  readonly setStartFromOrigin: (startFromOrigin: boolean) => void
  readonly loadChangeRequests: () => Promise<void>
  readonly checkoutChangeRequest: (headRef: string) => Promise<boolean>
}

/**
 * Controller for the composer context strip (WS1b). Holds the per-session
 * worktree plan (env mode + Worktree base ref + start-from-origin), persists it
 * to the backend so birth uses it, and computes the send gate.
 */
export function useComposerContextStrip(
  input: UseComposerContextStripInput,
): ComposerContextStripState {
  const { sessionId, projectPath, isFirstMessage, session, defaultEnvironmentMode } = input
  const hasWorktree = Boolean(session?.worktreePath?.trim())

  const [envMode, setEnvModeState] = useState<SessionEnvironmentMode>(
    session?.environmentMode ?? defaultEnvironmentMode,
  )
  const [baseRef, setBaseRefState] = useState<string | null>(session?.worktreeBaseRef ?? null)
  const [startFromOrigin, setStartFromOriginState] = useState<boolean>(
    session?.worktreeStartFromOrigin ?? false,
  )
  const [branchNames, setBranchNames] = useState<readonly string[]>([])
  const [changeRequests, setChangeRequests] = useState<readonly VcsChangeRequest[]>([])
  const lastSessionRef = useRef<SessionId | null>(null)

  // Reset local plan when the active session changes.
  useEffect(() => {
    if (lastSessionRef.current === sessionId) return
    lastSessionRef.current = sessionId
    setEnvModeState(session?.environmentMode ?? defaultEnvironmentMode)
    setBaseRefState(session?.worktreeBaseRef ?? null)
    setStartFromOriginState(session?.worktreeStartFromOrigin ?? false)
  }, [sessionId, session, defaultEnvironmentMode])

  // Load branch names and seed the default base ref (current branch).
  useEffect(() => {
    if (!projectPath) return
    let cancelled = false
    void (async () => {
      try {
        const result = await api.listGitBranches(projectPath)
        if (cancelled) return
        setBranchNames(result.branches.flatMap((b) => (b.isRemote ? [] : [b.name])))
        setBaseRefState((current) => current ?? resolveDefaultWorktreeBaseRef(result))
      } catch (error) {
        logger.warn('Failed to list branches for context strip', { error: String(error) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectPath])

  const persist = useCallback(
    (next: {
      envMode: SessionEnvironmentMode
      baseRef: string | null
      startFromOrigin: boolean
    }) => {
      if (!sessionId) return
      void api
        .setSessionWorktreePlan(sessionId, {
          environmentMode: next.envMode,
          baseRef: next.baseRef,
          startFromOrigin: next.startFromOrigin,
        })
        .catch((error) => logger.warn('Failed to persist worktree plan', { error: String(error) }))
    },
    [sessionId],
  )

  const setEnvMode = useCallback(
    (mode: SessionEnvironmentMode) => {
      setEnvModeState(mode)
      persist({ envMode: mode, baseRef, startFromOrigin })
    },
    [persist, baseRef, startFromOrigin],
  )

  const setBaseRef = useCallback(
    (nextBaseRef: string) => {
      const normalized = nextBaseRef.trim() || null
      setBaseRefState(normalized)
      persist({ envMode, baseRef: normalized, startFromOrigin })
    },
    [persist, envMode, startFromOrigin],
  )

  const setStartFromOrigin = useCallback(
    (next: boolean) => {
      setStartFromOriginState(next)
      persist({ envMode, baseRef, startFromOrigin: next })
    },
    [persist, envMode, baseRef],
  )

  const loadChangeRequests = useCallback(async () => {
    if (!projectPath) return
    const result = await api.listChangeRequests(projectPath)
    if (result.ok) setChangeRequests(result.changeRequests)
  }, [projectPath])

  const checkoutChangeRequest = useCallback(
    async (headRef: string) => {
      if (!projectPath) return false
      const result = await api.checkoutChangeRequest(projectPath, headRef)
      if (result.ok) setBaseRef(headRef)
      return result.ok
    },
    [projectPath, setBaseRef],
  )

  const sendPlan = useMemo(
    () => resolveWorktreeSendPlan({ isFirstMessage, envMode, hasWorktree, baseRef }),
    [isFirstMessage, envMode, hasWorktree, baseRef],
  )

  return {
    visible: isFirstMessage && !hasWorktree,
    envMode,
    baseRef,
    startFromOrigin,
    branchNames,
    changeRequests,
    sendPlan,
    setEnvMode,
    setBaseRef,
    setStartFromOrigin,
    loadChangeRequests,
    checkoutChangeRequest,
  }
}
