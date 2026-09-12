import { randomUUID } from 'node:crypto'
import { DelegationId, DerivedGrantId, RunId, SessionId, WorkspaceId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionLifecycleIdentityService } from '../ports/session-lifecycle-identity-service'

export const SessionLifecycleIdentityServiceLive = Layer.succeed(SessionLifecycleIdentityService, {
  nextSessionId: Effect.sync(() => SessionId(randomUUID())),
  nextRunId: Effect.sync(() => RunId(randomUUID())),
  nextWorkspaceId: Effect.sync(() => WorkspaceId(randomUUID())),
  nextDelegationId: Effect.sync(() => DelegationId(randomUUID())),
  nextDerivedGrantId: Effect.sync(() => DerivedGrantId(randomUUID())),
  now: Effect.sync(() => Date.now()),
})
