import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'

/**
 * Whether a root Session agent reaches every project (ADR 0039).
 *
 * `originScopes` are the scopes that bound the agent's authority: the live scope of the CLI
 * profile it came from, if any, and the scope stored in its authority snapshot, if any. A root
 * from the desktop user has neither, or only catalog-wide ones, and reaches every project. Any
 * narrower scope keeps it inside its own project, and a Worker never reaches every project.
 *
 * The Sessions tool (when the agent calls it) and queued Follow-up delivery (when a Follow-up it
 * sent is delivered later) both decide with this function, so the two cannot drift apart.
 */
export function rootSessionReachesEveryProject(input: {
  readonly isRoot: boolean
  readonly originScopes: readonly Pick<LocalSessionProfileScope, 'all'>[]
}) {
  return input.isRoot && input.originScopes.every((scope) => scope.all === true)
}
