import { useChatStore } from '@/features/chat/state'
import { useSessionStore } from '@/features/sessions/state/session-store'
import { usePreferencesStore } from '@/features/settings/state'

interface SessionProjectSources {
  readonly activeSessionId: string | null
  /** The loaded active Session's project, or null while its detail has not loaded. */
  readonly activeSessionProjectPath: string | null
  /** The active Session's catalog summary project, known before its detail loads. */
  readonly activeSummaryProjectPath: string | null
  readonly preferredProjectPath: string | null
}

/**
 * The project the open Session belongs to. The global project preference only mirrors the
 * selected Session's project and is written through the Host after the switch; it lags behind,
 * and stays stale when the write fails. Reading it showed and saved another project's Project
 * Actions in an open Session. Before the Session's detail loads its catalog summary names the
 * project; a selected Session whose project is not known yet has no project rather than the
 * previous one. Without a Session (a draft, or no Session at all) this is the preference, which is
 * also the project a draft's composer creates its Session in.
 */
export function resolveSessionProjectPath(sources: SessionProjectSources): string | null {
  if (sources.activeSessionId === null) return sources.preferredProjectPath
  return sources.activeSessionProjectPath ?? sources.activeSummaryProjectPath
}

/** The open Session's project; see resolveSessionProjectPath. */
export function useSessionProjectPath(): string | null {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const activeSessionProjectPath = useChatStore((state) =>
    state.activeSession !== null && state.activeSession.id === state.activeSessionId
      ? state.activeSession.projectPath
      : null,
  )
  const activeSummaryProjectPath = useSessionStore((state) =>
    activeSessionId === null
      ? null
      : (state.sessions.find((session) => session.id === activeSessionId)?.projectPath ?? null),
  )
  const preferredProjectPath = usePreferencesStore((state) => state.settings.projectPath ?? null)
  return resolveSessionProjectPath({
    activeSessionId,
    activeSessionProjectPath,
    activeSummaryProjectPath,
    preferredProjectPath,
  })
}
