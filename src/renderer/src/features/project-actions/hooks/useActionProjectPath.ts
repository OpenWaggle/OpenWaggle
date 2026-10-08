import { useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'

interface ActionProjectSources {
  readonly activeSessionId: string | null
  readonly activeSession: { readonly id: string; readonly projectPath: string | null } | null
  readonly draftSession: { readonly projectPath: string | null } | null
  readonly preferredProjectPath: string | null
}

/**
 * The project whose Project Actions the workspace shows, runs and saves to: the open Session's
 * own project, or the project a draft Session was started in. The global project preference is
 * only a mirror of that choice, written through the Host after the switch; it lags behind and
 * stays stale when the write fails, and reading it showed (and saved) another project's actions
 * in an open Session. While a selected Session is still loading its project is unknown, so no
 * project is returned rather than the previous one.
 */
export function resolveActionProjectPath(sources: ActionProjectSources): string | null {
  if (sources.activeSessionId !== null) {
    return sources.activeSession?.id === sources.activeSessionId
      ? sources.activeSession.projectPath
      : null
  }
  if (sources.draftSession) return sources.draftSession.projectPath ?? sources.preferredProjectPath
  return sources.preferredProjectPath
}

/** The project Project Actions target in the workspace (see resolveActionProjectPath). */
export function useActionProjectPath(): string | null {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const activeSession = useChatStore((state) => state.activeSession)
  const draftSession = useChatStore((state) => state.draftSession)
  const preferredProjectPath = usePreferencesStore((state) => state.settings.projectPath)
  return resolveActionProjectPath({
    activeSessionId,
    activeSession,
    draftSession,
    preferredProjectPath: preferredProjectPath ?? null,
  })
}
