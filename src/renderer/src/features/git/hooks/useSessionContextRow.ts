import type { SessionId } from '@shared/types/brand'
import { RepositoryPath } from '@shared/types/brand'
import type { SessionEnvironmentMode, VcsChangeRequest } from '@shared/types/git'
import type { ChangeRequestAdoption } from '@shared/types/ipc-invoke-git'
import type { SessionDetail } from '@shared/types/session'
import { sessionWorktreeBranch } from '@shared/utils/worktree'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  resolveDefaultWorktreeBaseRef,
  resolveWorktreeSendPlan,
  type WorktreeSendPlan,
} from '@/features/git/lib/worktree-send-plan'
import {
  draftWorktreePlanKey,
  PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY,
  useWorktreePlanStore,
  type WorktreePlanOverride,
} from '@/features/git/state/worktree-plan-store'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { type ProjectBranchStatus, useProjectBranches } from './useProjectBranches'

const logger = createRendererLogger('composer-context-strip')

interface UseSessionContextRowInput {
  readonly sessionId: SessionId | null
  readonly projectPath: string | null
  readonly isFirstMessage: boolean
  readonly session: Pick<
    SessionDetail,
    'environmentMode' | 'worktreePath' | 'worktreeBaseRef' | 'worktreeStartFromOrigin'
  > | null
  readonly defaultEnvironmentMode: SessionEnvironmentMode
}

export interface SessionContextRowState {
  readonly visible: boolean
  readonly editable: boolean
  readonly envMode: SessionEnvironmentMode
  readonly baseRef: string | null
  /** The Session worktree path once it exists, so the run target can show its branch. */
  readonly worktreePath: string | null
  readonly startFromOrigin: boolean
  readonly branchNames: readonly string[]
  readonly branchStatus: ProjectBranchStatus
  readonly changeRequests: readonly VcsChangeRequest[]
  readonly sendPlan: WorktreeSendPlan
  readonly setEnvMode: (mode: SessionEnvironmentMode) => void
  readonly setBaseRef: (baseRef: string) => void
  readonly setStartFromOrigin: (startFromOrigin: boolean) => void
  readonly loadChangeRequests: () => Promise<void>
  readonly checkoutChangeRequest: (headRef: string) => Promise<boolean>
  /** Recreate a vanished Session worktree from its recorded base ref. */
  readonly recreateWorktree: () => Promise<boolean>
  /** Abandon the vanished worktree and run this session in the opened checkout. */
  readonly switchToLocalMode: () => void
}

function resolveEffectivePlan(
  override: WorktreePlanOverride | undefined,
  session: UseSessionContextRowInput['session'],
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
export function useSessionContextRow(input: UseSessionContextRowInput): SessionContextRowState {
  const { sessionId, projectPath, isFirstMessage, session, defaultEnvironmentMode } = input
  const hasWorktree = Boolean(session?.worktreePath?.trim())
  // Sessions are created lazily on first send, so before that key the plan on a
  // draft key derived from the project; the send path flushes it onto the new
  // session (review renderer-B1). Falls back to the session id once it exists.
  const sessionKey = sessionId
    ? String(sessionId)
    : projectPath
      ? draftWorktreePlanKey(projectPath)
      : isFirstMessage
        ? PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY
        : ''

  const override = useWorktreePlanStore((state) => {
    if (!sessionKey) return undefined
    const scopedOverride = state.bySessionId[sessionKey]
    if (scopedOverride || sessionId || !projectPath) return scopedOverride
    return state.bySessionId[PROJECTLESS_DRAFT_WORKTREE_PLAN_KEY]
  })
  const setOverride = useWorktreePlanStore((s) => s.setOverride)

  const branches = useProjectBranches(projectPath)
  const [changeRequests, setChangeRequests] = useState<readonly VcsChangeRequest[]>([])
  // undefined = not yet checked, so a send is never blocked on an unknown.
  const [worktreeExists, setWorktreeExists] = useState<boolean | undefined>(undefined)

  /*
   * A recorded worktree can vanish out-of-band, and the send must stop rather than the
   * agent silently receiving a fresh empty tree. Re-checked when the recorded path
   * changes and whenever this session's working tree is reported as changed.
   */
  const recordedWorktreePath = session?.worktreePath?.trim() ?? null
  useEffect(() => {
    if (recordedWorktreePath === null) {
      setWorktreeExists(undefined)
      return
    }
    let cancelled = false
    const check = () => {
      void api
        .checkSessionWorktree(recordedWorktreePath)
        .then((result) => {
          if (!cancelled) setWorktreeExists(result.exists)
        })
        .catch((error) => logger.warn('Failed to check Session worktree', { error: String(error) }))
    }
    check()
    const unsubscribe = api.onGitWorkingTreeChanged(({ workingPath }) => {
      if (workingPath === recordedWorktreePath) check()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [recordedWorktreePath])

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
      const result = await api.listChangeRequests(RepositoryPath(projectPath))
      if (result.ok) setChangeRequests(result.changeRequests)
      else logger.warn('Failed to list change requests', { code: result.code })
    } catch (error) {
      logger.warn('Failed to list change requests', { error: String(error) })
    }
  }, [projectPath])

  const checkoutChangeRequest = useCallback(
    async (headRef: string) => {
      if (!projectPath) return false
      /*
       * Worktree mode fetches by change-request URL, not by head branch name: the branch only exists
       * on `origin` for a same-repository change request, so a fork-based one either failed or
       * silently resolved to an unrelated origin branch of the same name.
       */
      const selected = changeRequests.find((request) => request.headRef === headRef)
      /*
       * A worktree-mode session only needs the ref as a base for its own tree, so fetch it and
       * record it. Checking it out would switch the user's opened checkout to the change-request
       * branch - a tree this session never runs in - and would fail or leave partial state when
       * that checkout is dirty.
       */
      const adoption: ChangeRequestAdoption = envMode === 'worktree' ? 'fetch' : 'checkout'
      const reference = adoption === 'fetch' ? (selected?.url ?? headRef) : headRef
      try {
        const result = await api.checkoutChangeRequest(
          RepositoryPath(projectPath),
          reference,
          adoption,
        )
        if (result.ok) {
          // Main reports the ref it actually made available, which for a fetch is a local ref.
          setBaseRef(result.reference)
          return true
        }
        logger.warn('Change request adoption failed', { code: result.code, adoption })
        return false
      } catch (error) {
        logger.warn('Change request adoption failed', { error: String(error), adoption })
        return false
      }
    },
    [projectPath, setBaseRef, envMode, changeRequests],
  )

  const sendPlan = useMemo(
    () =>
      resolveWorktreeSendPlan({ isFirstMessage, envMode, hasWorktree, baseRef, worktreeExists }),
    [isFirstMessage, envMode, hasWorktree, baseRef, worktreeExists],
  )

  const recreateWorktree = useCallback(async () => {
    if (!projectPath || recordedWorktreePath === null) return false
    const forkPoint = baseRef?.trim()
    if (sessionId === null || !forkPoint) return false
    try {
      /*
       * Main resolves the branch from the session id. Deriving it here missed the legacy convention
       * entirely, so recreating an older session's tree created a fresh branch at the base ref and
       * left the agent's commits stranded on the old one.
       */
      const result = await api.createGitWorktree(RepositoryPath(projectPath), {
        path: recordedWorktreePath,
        branch: sessionWorktreeBranch(String(sessionId)),
        baseRef: forkPoint,
        sessionId: String(sessionId),
      })
      if (result.ok) setWorktreeExists(true)
      return result.ok
    } catch (error) {
      logger.warn('Failed to recreate Session worktree', { error: String(error) })
      return false
    }
  }, [projectPath, recordedWorktreePath, baseRef, sessionId])

  const switchToLocalMode = useCallback(() => {
    // Running in the opened checkout is a real change of isolation, so it is recorded
    // on the session rather than only reflected in this row.
    const next = { envMode: 'local' as const, baseRef, startFromOrigin }
    if (sessionKey) setOverride(sessionKey, next)
    persist(next)
  }, [baseRef, startFromOrigin, sessionKey, setOverride, persist])

  return {
    /*
     * Normally the row only appears before a worktree exists, because after that there
     * is nothing left to choose. A vanished worktree is the exception: the row has to
     * come back to carry the message and the recover/switch actions.
     */
    visible: sessionKey !== '',
    editable: isFirstMessage && !hasWorktree && sendPlan.kind !== 'worktree-missing',
    envMode,
    baseRef,
    worktreePath: recordedWorktreePath,
    startFromOrigin,
    branchNames: branches.names,
    branchStatus: branches.status,
    changeRequests,
    sendPlan,
    setEnvMode,
    setBaseRef,
    setStartFromOrigin,
    loadChangeRequests,
    checkoutChangeRequest,
    recreateWorktree,
    switchToLocalMode,
  }
}
