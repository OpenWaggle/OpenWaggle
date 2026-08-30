import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import type { SessionCapability } from '@shared/types/session-capability'
import type {
  SessionLifecycleRequest,
  SessionLifecycleResponse,
} from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { SessionLifecycleIdentityService } from '../ports/session-lifecycle-identity-service'
import {
  type PreparedSessionLifecycleAttempt,
  type SessionLifecycleAllocatedIdentities,
  SessionLifecyclePreparationService,
} from '../ports/session-lifecycle-preparation-service'
import { SessionLifecycleRepository } from '../ports/session-lifecycle-repository'

export interface ExecuteSessionLifecycleCommandInput {
  readonly callerId: string
  readonly callerCapabilities?: readonly SessionCapability[]
  readonly callerAuthorizationCeiling?: AgentAuthorizationMode
  readonly callerAuthorityScope?: LocalSessionProfileScope
  readonly initiatingWorkingDirectory?: string
  readonly request: SessionLifecycleRequest
}

function repositoryInput(
  input: ExecuteSessionLifecycleCommandInput,
  allocated: SessionLifecycleAllocatedIdentities,
  attempt: PreparedSessionLifecycleAttempt,
  now: number,
) {
  return {
    callerId: input.callerId,
    ...(input.callerAuthorityScope ? { callerAuthorityScope: input.callerAuthorityScope } : {}),
    request: input.request,
    session: attempt.session,
    ...(allocated.runId ? { runId: allocated.runId } : {}),
    ...(allocated.delegationId ? { delegationId: allocated.delegationId } : {}),
    ...(allocated.derivedGrantId ? { derivedGrantId: allocated.derivedGrantId } : {}),
    workspacePlan: attempt.workspacePlan,
    executionSnapshot: attempt.executionSnapshot,
    ...(attempt.derivedCapabilities ? { derivedCapabilities: attempt.derivedCapabilities } : {}),
    ...(attempt.parentConcurrencyLimit
      ? { parentConcurrencyLimit: attempt.parentConcurrencyLimit }
      : {}),
    ...(attempt.hostRunCeiling ? { hostRunCeiling: attempt.hostRunCeiling } : {}),
    ...(attempt.forkSnapshot ? { forkSnapshot: attempt.forkSnapshot } : {}),
    ...(attempt.forkEditorText ? { forkEditorText: attempt.forkEditorText } : {}),
    ...(attempt.forkSourceNodeId ? { forkSourceNodeId: attempt.forkSourceNodeId } : {}),
    now,
  }
}

function allocateLifecycleIdentities(request: SessionLifecycleRequest) {
  return Effect.gen(function* () {
    const identities = yield* SessionLifecycleIdentityService
    const sessionId = yield* identities.nextSessionId
    const workspaceId = yield* identities.nextWorkspaceId

    return yield* matchBy(request.command, 'operation')
      .with('create', () => Effect.succeed({ sessionId, workspaceId }))
      .with('fork', () => Effect.succeed({ sessionId, workspaceId }))
      .with('launch', () =>
        Effect.gen(function* () {
          const runId = yield* identities.nextRunId
          return { sessionId, workspaceId, runId }
        }),
      )
      .with('spawn', () =>
        Effect.gen(function* () {
          const runId = yield* identities.nextRunId
          const delegationId = yield* identities.nextDelegationId
          const derivedGrantId = yield* identities.nextDerivedGrantId
          return { sessionId, workspaceId, runId, delegationId, derivedGrantId }
        }),
      )
      .exhaustive()
  })
}

export function executeSessionLifecycle(
  input: ExecuteSessionLifecycleCommandInput,
): Effect.Effect<
  SessionLifecycleResponse,
  unknown,
  SessionLifecycleIdentityService | SessionLifecyclePreparationService | SessionLifecycleRepository
> {
  return Effect.gen(function* () {
    const identities = yield* SessionLifecycleIdentityService
    const preparation = yield* SessionLifecyclePreparationService
    const repository = yield* SessionLifecycleRepository
    const replay = repository.findReplay
      ? yield* repository.findReplay({ callerId: input.callerId, request: input.request })
      : undefined
    if (replay) return replay
    const allocated: SessionLifecycleAllocatedIdentities = yield* allocateLifecycleIdentities(
      input.request,
    )
    const attempt = yield* preparation.prepare({
      callerId: input.callerId,
      ...(input.callerCapabilities ? { callerCapabilities: input.callerCapabilities } : {}),
      ...(input.callerAuthorizationCeiling
        ? { callerAuthorizationCeiling: input.callerAuthorizationCeiling }
        : {}),
      ...(input.initiatingWorkingDirectory
        ? { initiatingWorkingDirectory: input.initiatingWorkingDirectory }
        : {}),
      request: input.request,
      identities: allocated,
    })
    const now = yield* identities.now
    const response = yield* repository
      .execute(repositoryInput(input, allocated, attempt, now))
      .pipe(Effect.tapError(() => preparation.discard({ attempt, reason: 'repository-failure' })))

    if (response.replayed || response.outcome.effect === 'rejected') {
      yield* preparation.discard({
        attempt,
        reason: response.replayed ? 'replayed' : 'rejected',
      })
    } else {
      yield* preparation.commit({ attempt })
    }
    return response
  })
}
