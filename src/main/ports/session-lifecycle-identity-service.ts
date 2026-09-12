import type {
  DelegationId,
  DerivedGrantId,
  RunId,
  SessionId,
  WorkspaceId,
} from '@shared/types/brand'
import { Context, type Effect } from 'effect'

export interface SessionLifecycleIdentityServiceShape {
  readonly nextSessionId: Effect.Effect<SessionId>
  readonly nextRunId: Effect.Effect<RunId>
  readonly nextWorkspaceId: Effect.Effect<WorkspaceId>
  readonly nextDelegationId: Effect.Effect<DelegationId>
  readonly nextDerivedGrantId: Effect.Effect<DerivedGrantId>
  readonly now: Effect.Effect<number>
}

export class SessionLifecycleIdentityService extends Context.Tag(
  '@openwaggle/SessionLifecycleIdentityService',
)<SessionLifecycleIdentityService, SessionLifecycleIdentityServiceShape>() {}
