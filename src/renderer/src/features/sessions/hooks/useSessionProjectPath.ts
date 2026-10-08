import { useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'

interface SessionProjectSources {
  readonly activeSessionId: string | null
  /** The loaded active Session's project, or null when the loaded Session is another one. */
  readonly activeSessionProjectPath: string | null
  readonly draftProjectPath: string | null
  readonly hasDraft: boolean
  readonly preferredProjectPath: string | null
}

/**
 * The project the open Session belongs to: the active Session's own project, or the project a
 * draft Session was started in. The global project preference only mirrors that choice and is
 * written through the Host after the switch; it lags behind, and stays stale when the write
 * fails. Reading it showed and saved another project's Project Actions in an open Session. While
 * a selected Session is still loading its project is unknown, so no project is returned rather
 * than the previous one. The preference is used only when there is neither a Session nor a draft
 * project.
 */
export function resolveSessionProjectPath(sources: SessionProjectSources): string | null {
  if (sources.activeSessionId !== null) return sources.activeSessionProjectPath
  if (sources.hasDraft) return sources.draftProjectPath ?? sources.preferredProjectPath
  return sources.preferredProjectPath
}

/** The open Session's (or draft's) project; see resolveSessionProjectPath. */
export function useSessionProjectPath(): string | null {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const activeSessionProjectPath = useChatStore((state) =>
    state.activeSession !== null && state.activeSession.id === state.activeSessionId
      ? state.activeSession.projectPath
      : null,
  )
  const hasDraft = useChatStore((state) => state.draftSession !== null)
  const draftProjectPath = useChatStore((state) => state.draftSession?.projectPath ?? null)
  const preferredProjectPath = usePreferencesStore((state) => state.settings.projectPath ?? null)
  return resolveSessionProjectPath({
    activeSessionId,
    activeSessionProjectPath,
    draftProjectPath,
    hasDraft,
    preferredProjectPath,
  })
}
