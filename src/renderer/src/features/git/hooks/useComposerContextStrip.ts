import type { SessionId } from '@shared/types/brand'
import type { SessionEnvironmentMode, VcsChangeRequest } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  resolveDefaultWorktreeBaseRef,
  resolveWorktreeSendPlan,
  type WorktreeSendPlan,
} from '@/features/git/lib/worktree-send-plan'
import {
  draftWorktreePlanKey,
  useWorktreePlanStore,
  type WorktreePlanOverride,
} from '@/features/git/state/worktree-plan-store'
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

interface BranchListState {
  readonly currentBranch: string | null
  readonly names: readonly string[]
}

const EMPTY_BRANCHES: BranchListState = { currentBranch: null, names: [] }

function resolveEffectivePlan(
  override: WorktreePlanOverride | undefined,
  session: UseComposerContextStripInput['session'],
  defaultEnvironmentMode: SessionEnvironmentMode,
  currentBranch: string | null,
) {
  const defaultBaseRef =
    session?.worktreeBaseRef ?? resolveDefaultWorktreeBaseRef({ currentBranch })
  return {
    envMode: override?.envMode ?? session?.environmentMode ?? defaultEnvironmentMode,
    baseRef: override?.baseRef !== undefined ? override.baseRef : defaultBaseRef,
    startFromOrigin: override?.startFromOrigin ?? session?.worktreeStartFromOrigin ?? false,
  }
}

/**
 * Controller for the composer context strip (WS1b). Effective plan values are
 * computed from per-session overrides layered over the session defaults (no
 * props-into-state sync), and persisted to the backend so worktree birth uses
 * them.
 */
export function useComposerContextStrip(
  input: UseComposerContextStripInput,
): ComposerContextStripState {
  const { sessionId, projectPath, isFirstMessage, session, defaultEnvironmentMode } = input
  const hasWorktree = Boolean(session?.worktreePath?.trim())
  // Sessions are created lazily on first send, so before that key the plan on a
  // draft key derived from the project; the send path flushes it onto the new
  // session (review renderer-B1). Falls back to the session id once it exists.
  const sessionKey = sessionId
    ? String(sessionId)
    : projectPath
      ? draftWorktreePlanKey(projectPath)
      : ''

  const override = useWorktreePlanStore((s) => (sessionKey ? s.bySessionId[sessionKey] : undefined))
  const setOverride = useWorktreePlanStore((s) => s.setOverride)

  const [branches, setBranches] = useState<BranchListState>(EMPTY_BRANCHES)
  const [changeRequests, setChangeRequests] = useState<readonly VcsChangeRequest[]>([])

  useEffect(() => {
    if (!projectPath) {
      setBranches(EMPTY_BRANCHES)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await api.listGitBranches(projectPath)
        if (cancelled) return
        setBranches({
          currentBranch: result.currentBranch,
          names: result.branches.flatMap((b) => (b.isRemote ? [] : [b.name])),
        })
      } catch (error) {
        logger.warn('Failed to list branches for context strip', { error: String(error) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectPath])

  const { envMode, baseRef, startFromOrigin } = resolveEffectivePlan(
    override,
    session,
    defaultEnvironmentMode,
    branches.currentBranch,
  )

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
      if (!sessionKey) return
      setOverride(sessionKey, { envMode: mode })
      persist({ envMode: mode, baseRef, startFromOrigin })
    },
    [sessionKey, setOverride, persist, baseRef, startFromOrigin],
  )

  const setBaseRef = useCallback(
    (nextBaseRef: string) => {
      if (!sessionKey) return
      const normalized = nextBaseRef.trim() || null
      setOverride(sessionKey, { baseRef: normalized })
      persist({ envMode, baseRef: normalized, startFromOrigin })
    },
    [sessionKey, setOverride, persist, envMode, startFromOrigin],
  )

  const setStartFromOrigin = useCallback(
    (next: boolean) => {
      if (!sessionKey) return
      setOverride(sessionKey, { startFromOrigin: next })
      persist({ envMode, baseRef, startFromOrigin: next })
    },
    [sessionKey, setOverride, persist, envMode, baseRef],
  )

  const loadChangeRequests = useCallback(async () => {
    if (!projectPath) return
    try {
      const result = await api.listChangeRequests(projectPath)
      if (result.ok) setChangeRequests(result.changeRequests)
      else logger.warn('Failed to list change requests', { code: result.code })
    } catch (error) {
      logger.warn('Failed to list change requests', { error: String(error) })
    }
  }, [projectPath])

  const checkoutChangeRequest = useCallback(
    async (headRef: string) => {
      if (!projectPath) return false
      try {
        const result = await api.checkoutChangeRequest(projectPath, headRef)
        if (result.ok) {
          setBaseRef(headRef)
          return true
        }
        logger.warn('Change request checkout failed', { code: result.code })
        return false
      } catch (error) {
        logger.warn('Change request checkout failed', { error: String(error) })
        return false
      }
    },
    [projectPath, setBaseRef],
  )

  const sendPlan = useMemo(
    () => resolveWorktreeSendPlan({ isFirstMessage, envMode, hasWorktree, baseRef }),
    [isFirstMessage, envMode, hasWorktree, baseRef],
  )

  return {
    visible: sessionKey !== '' && isFirstMessage && !hasWorktree,
    envMode,
    baseRef,
    startFromOrigin,
    branchNames: branches.names,
    changeRequests,
    sendPlan,
    setEnvMode,
    setBaseRef,
    setStartFromOrigin,
    loadChangeRequests,
    checkoutChangeRequest,
  }
}
