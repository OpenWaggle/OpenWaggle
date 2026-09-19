import { Context, type Effect } from 'effect'
import type { SessionControlRepositoryError } from '../errors'

export interface ActiveDescendantRun {
  readonly sessionId: string
  readonly runId: string
  readonly depth: number
}

export interface SessionDescendantRunRepositoryShape {
  readonly listActive: (input: {
    readonly ancestorSessionId: string
  }) => Effect.Effect<readonly ActiveDescendantRun[], SessionControlRepositoryError>
}

export class SessionDescendantRunRepository extends Context.Tag(
  '@openwaggle/SessionDescendantRunRepository',
)<SessionDescendantRunRepository, SessionDescendantRunRepositoryShape>() {}
