import { isActiveActionRun } from '@shared/types/action-runs'
import { useActionRuns } from './useNativeActions'

/** Whether a Project action run is active in this Session's workspace (the rail's running dot). */
export function useHasActiveProjectActionRun(
  projectPath: string | null,
  sessionId: string | null,
): boolean {
  const runs = useActionRuns(projectPath && sessionId ? { projectPath, sessionId } : null)
  return (runs.data ?? []).some(isActiveActionRun)
}
