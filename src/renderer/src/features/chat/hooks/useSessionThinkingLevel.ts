import type { SessionId } from '@shared/types/brand'
import { DEFAULT_THINKING_LEVEL, type ThinkingLevel } from '@shared/types/settings'
import { queryOptions, type UseQueryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBackgroundRunStore, useChatStore } from '@/features/chat/state'
import { useIsRunFinishing } from '@/features/chat/state/run-finishing-store'
import {
  DEFAULT_THINKING_LEVEL_TARGET,
  SessionThinkingLevelRefusedError,
  usePendingThinkingLevelStore,
  writeThinkingLevel,
} from '@/features/chat/state/session-thinking-level-writes'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'

export { SessionThinkingLevelRefusedError } from '@/features/chat/state/session-thinking-level-writes'

type DefaultThinkingLevelKey = readonly ['pi-default-thinking-level', string | null]

/** Pi's default thinking level, where a new Session starts (project settings over global). */
export function defaultThinkingLevelQueryOptions(
  projectPath: string | null,
): UseQueryOptions<ThinkingLevel, Error, ThinkingLevel, DefaultThinkingLevelKey> {
  return queryOptions({
    queryKey: ['pi-default-thinking-level', projectPath] as const,
    queryFn: () => api.getDefaultThinkingLevel(projectPath),
  })
}

export interface SessionThinkingLevel {
  /**
   * The thinking level the Session's next Run uses, before it is clamped to the model; for a
   * draft (no Session yet), Pi's default that the new Session will start from.
   */
  readonly level: ThinkingLevel
  /**
   * Sets it. For a Session the Host refuses while a Run is active, rejecting with a
   * `SessionThinkingLevelRefusedError`; the desktop user's pick also becomes Pi's global default
   * (never changing another Session). For a draft it sets Pi's global default.
   */
  readonly setLevel: (level: ThinkingLevel) => Promise<void>
  /**
   * False while the Session has a Run starting, active, or finishing. A Session waiting on its
   * Follow-up queue can change. Model changes follow the same rule.
   */
  readonly canChange: boolean
}

/**
 * The Session thinking level, kept by Pi with the Session like its model. Messages and queued
 * Follow-ups never carry one: a Run uses the Session's level when it starts.
 */
export function useSessionThinkingLevel(sessionId: SessionId | null): SessionThinkingLevel {
  const queryClient = useQueryClient()
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const defaultQuery = useQuery(defaultThinkingLevelQueryOptions(projectPath))
  const storedSessionLevel = useChatStore((state) => {
    if (!sessionId) return undefined
    const active = state.activeSessionId === sessionId ? state.activeSession : null
    return (
      active?.executionThinkingLevel ?? state.sessionById.get(sessionId)?.executionThinkingLevel
    )
  })
  const target = sessionId ?? DEFAULT_THINKING_LEVEL_TARGET
  const pendingLevel = usePendingThinkingLevelStore((state) => state.pending.get(target))
  const hasActiveRun = useBackgroundRunStore((state) =>
    sessionId ? state.activeRunIds.has(sessionId) : false,
  )
  const isFinishing = useIsRunFinishing(sessionId)
  const defaultLevel = defaultQuery.data ?? DEFAULT_THINKING_LEVEL
  const level = pendingLevel ?? (sessionId ? storedSessionLevel : undefined) ?? defaultLevel
  const canChange = sessionId === null || !(hasActiveRun || isFinishing)

  function refreshDefault() {
    // Other projects' defaults refetch when next observed (they are stale from the start).
    return queryClient.invalidateQueries({
      queryKey: defaultThinkingLevelQueryOptions(projectPath).queryKey,
    })
  }

  function setLevel(next: ThinkingLevel) {
    if (!sessionId) {
      return writeThinkingLevel({
        target,
        level: next,
        write: () => api.setDefaultThinkingLevel(next),
        refresh: refreshDefault,
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
        await Promise.all([useChatStore.getState().refreshSession(sessionId), refreshDefault()])
      },
    })
  }

  return { level, setLevel, canChange }
}
