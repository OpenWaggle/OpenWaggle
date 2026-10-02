import type { SessionId } from '@shared/types/brand'
import { DEFAULT_THINKING_LEVEL, type ThinkingLevel } from '@shared/types/settings'
import {
  type QueryClient,
  queryOptions,
  type UseQueryOptions,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useBackgroundRunStore, useChatStore } from '@/features/chat/state'
import { useFirstSendPendingStore } from '@/features/chat/state/first-send-pending-store'
import { useForegroundSendStore } from '@/features/chat/state/foreground-send-store'
import { useIsRunFinishing } from '@/features/chat/state/run-finishing-store'
import {
  DEFAULT_THINKING_LEVEL_TARGET,
  SessionThinkingLevelRefusedError,
  usePendingThinkingLevelStore,
  writeThinkingLevel,
} from '@/features/chat/state/session-thinking-level-writes'
import { api } from '@/shared/lib/ipc'

export { SessionThinkingLevelRefusedError } from '@/features/chat/state/session-thinking-level-writes'

const DEFAULT_THINKING_LEVEL_QUERY_KEY = ['pi-default-thinking-level'] as const

/**
 * Pi's global default thinking level, where every new Session starts. OpenWaggle never uses a
 * project-level Pi default, so the draft picker shows one value in every project.
 */
export function defaultThinkingLevelQueryOptions(): UseQueryOptions<
  ThinkingLevel,
  Error,
  ThinkingLevel,
  typeof DEFAULT_THINKING_LEVEL_QUERY_KEY
> {
  return queryOptions({
    queryKey: DEFAULT_THINKING_LEVEL_QUERY_KEY,
    queryFn: () => api.getDefaultThinkingLevel(),
  })
}

/**
 * Refreshes every cached read of Pi's default. Called after this window changes it and when the
 * Host reports another window (or Session) changed it.
 */
export function invalidateDefaultThinkingLevel(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: DEFAULT_THINKING_LEVEL_QUERY_KEY })
}

/**
 * Whether the Session's settings (its model and thinking level) may change now: never while a Run
 * is starting (the first send, a composer send in flight, a worktree launch), active, or finishing.
 * A Session waiting on its Follow-up queue can change, and so can a draft (`null`). The Host
 * enforces the same rule; this keeps the pickers from offering a change it would refuse.
 */
export function useSessionSettingsChangeable(sessionId: SessionId | null): boolean {
  const hasActiveRun = useBackgroundRunStore((state) =>
    sessionId ? state.activeRunIds.has(sessionId) : false,
  )
  const isLaunching = useBackgroundRunStore((state) =>
    sessionId ? state.worktreeLaunchBySessionId.get(sessionId)?.status === 'running' : false,
  )
  const isFirstSendPending = useFirstSendPendingStore((state) =>
    sessionId ? state.ids.has(sessionId) : false,
  )
  const isSending = useForegroundSendStore((state) =>
    sessionId ? state.counts.has(sessionId) : false,
  )
  const isFinishing = useIsRunFinishing(sessionId)
  if (sessionId === null) return true
  return !(hasActiveRun || isLaunching || isFirstSendPending || isSending || isFinishing)
}

export interface SessionThinkingLevel {
  /**
   * The thinking level the Session's next Run uses, before it is clamped to the model; for a
   * draft (no Session yet), Pi's global default that the new Session will start from.
   */
  readonly level: ThinkingLevel
  /**
   * Sets it. For a Session the Host refuses while a Run is active, rejecting with a
   * `SessionThinkingLevelRefusedError`; the desktop user's pick also becomes Pi's global default
   * (never changing another Session). For a draft it sets Pi's global default, and first send
   * stores it on the Session it creates.
   */
  readonly setLevel: (level: ThinkingLevel) => Promise<void>
  /** `useSessionSettingsChangeable(sessionId)`: false while a Run is starting, active, or finishing. */
  readonly canChange: boolean
}

/**
 * The Session thinking level, kept by Pi with the Session like its model. Messages and queued
 * Follow-ups never carry one: a Run uses the Session's level when it starts.
 */
export function useSessionThinkingLevel(sessionId: SessionId | null): SessionThinkingLevel {
  const queryClient = useQueryClient()
  const defaultQuery = useQuery(defaultThinkingLevelQueryOptions())
  const storedSessionLevel = useChatStore((state) => {
    if (!sessionId) return undefined
    const active = state.activeSessionId === sessionId ? state.activeSession : null
    return (
      active?.executionThinkingLevel ?? state.sessionById.get(sessionId)?.executionThinkingLevel
    )
  })
  const target = sessionId ?? DEFAULT_THINKING_LEVEL_TARGET
  const pendingLevel = usePendingThinkingLevelStore((state) => state.pending.get(target))
  const canChange = useSessionSettingsChangeable(sessionId)
  const defaultLevel = defaultQuery.data ?? DEFAULT_THINKING_LEVEL
  const level = pendingLevel ?? (sessionId ? storedSessionLevel : undefined) ?? defaultLevel

  function setLevel(next: ThinkingLevel) {
    if (!sessionId) {
      return writeThinkingLevel({
        target,
        level: next,
        write: () => api.setDefaultThinkingLevel(next),
        refresh: () => invalidateDefaultThinkingLevel(queryClient),
      })
    }
    return writeThinkingLevel({
      target,
      level: next,
      write: async () => {
        const change = await api.setSessionThinkingLevel(sessionId, next)
        if (!change.changed) throw new SessionThinkingLevelRefusedError(change.code)
      },
      refresh: async () => {
        await Promise.all([
          useChatStore.getState().refreshSession(sessionId),
          invalidateDefaultThinkingLevel(queryClient),
        ])
      },
    })
  }

  return { level, setLevel, canChange }
}
