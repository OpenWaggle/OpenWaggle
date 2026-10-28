import type { QueryKey } from '@tanstack/react-query'
import { queryKeys } from '@/queries/query-keys'

/** The Sessions a batch of Host events changed, and the projects they belong to. */
export interface ProjectActionSessionChange {
  readonly sessionIds: ReadonlySet<string>
  readonly projectPaths: ReadonlySet<string>
  /**
   * A changed Session the window has not loaded (created in the same batch, or a Worker beyond the
   * loaded catalog page): its project is unknown, so every project's queries may have changed.
   */
  readonly unknownProject: boolean
}

const PROJECT_SEGMENT = 1
const SCOPE_SEGMENT = 2
/** Task discovery reads the project's files; a Session's state changing does not change them. */
const DISCOVERY_KIND = 'discovery'

/** The Session a Project Actions query is scoped to: its id, or a scope object's `sessionId`. */
function scopeSessionId(segment: unknown) {
  if (typeof segment === 'string') return segment
  if (typeof segment !== 'object' || segment === null) return null
  const sessionId: unknown = Reflect.get(segment, 'sessionId')
  return typeof sessionId === 'string' ? sessionId : null
}

/**
 * Whether a Session change can have changed what a Project Actions query read: one scoped to a
 * changed Session, or to a changed Session's project (its catalog, shortcuts, runs, preparation).
 * When a changed Session's project is unknown, every non-discovery query is. Keys are
 * `['native-actions', projectPath, scope, kind]`; discovery is left to focus and mount.
 */
export function isProjectActionQueryAffected(
  queryKey: QueryKey,
  change: ProjectActionSessionChange,
) {
  if (queryKey[0] !== queryKeys.projectActions[0]) return false
  if (queryKey.at(-1) === DISCOVERY_KIND) return false
  if (change.unknownProject) return true
  const projectPath = queryKey[PROJECT_SEGMENT]
  if (typeof projectPath === 'string' && change.projectPaths.has(projectPath)) return true
  const sessionId = scopeSessionId(queryKey[SCOPE_SEGMENT])
  return sessionId !== null && change.sessionIds.has(sessionId)
}
