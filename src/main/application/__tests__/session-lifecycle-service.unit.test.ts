import { DelegationId, DerivedGrantId, RunId, SessionId, WorkspaceId } from '@shared/types/brand'
import type { SessionLifecycleRequest } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { SessionLifecycleRepositoryError } from '../../errors'
import { SessionLifecycleIdentityService } from '../../ports/session-lifecycle-identity-service'
import {
  type PreparedSessionLifecycleAttempt,
  SessionLifecyclePreparationService,
} from '../../ports/session-lifecycle-preparation-service'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import { executeSessionLifecycle } from '../session-lifecycle-service'

const request: SessionLifecycleRequest = {
  contractVersion: 2,
  requestId: 'request-spawn',
  idempotencyKey: 'idempotency-spawn',
  command: {
    operation: 'spawn',
    parentSessionId: 'session-parent',
    expectedParentRunId: 'run-parent',
    workspace: { mode: 'share-parent' },
    delegation: {
      objective: 'Implement the verifier.',
      deliverables: ['Implementation'],
      acceptanceCriteria: ['Tests pass'],
      dependencies: [],
      resourceReferences: [],
    },
  },
}

const prepared: PreparedSessionLifecycleAttempt = {
  attemptId: 'attempt-spawn',
  session: {
    sessionId: 'session-worker',
    piSessionId: 'pi-worker',
    piSessionFile: '/sessions/worker.jsonl',
  },
  workspacePlan: { mode: 'parent' },
  executionSnapshot: {
    profile: { modelId: 'provider/model' },
    authorizationCeiling: 'ask-for-approval',
  },
  derivedCapabilities: ['sessions:message'],
  parentConcurrencyLimit: 4,
  hostRunCeiling: 16,
}

function identityLayer() {
  return Layer.succeed(SessionLifecycleIdentityService, {
    nextSessionId: Effect.succeed(SessionId('session-worker')),
    nextRunId: Effect.succeed(RunId('run-worker')),
    nextWorkspaceId: Effect.succeed(WorkspaceId('workspace-worker')),
    nextDelegationId: Effect.succeed(DelegationId('delegation-worker')),
    nextDerivedGrantId: Effect.succeed(DerivedGrantId('grant-worker')),
    now: Effect.succeed(2000),
  })
}

describe('Session lifecycle service', () => {
  it('returns a durable replay before allocating or preparing external resources', async () => {
    const replay = {
      contractVersion: 2 as const,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      replayed: true,
      outcome: {
        operation: 'spawn' as const,
        effect: 'rejected' as const,
        code: 'host_lost',
        retryable: true,
      },
    }
    const layer = Layer.mergeAll(
      Layer.succeed(SessionLifecycleIdentityService, {
        nextSessionId: Effect.die('must not allocate'),
        nextRunId: Effect.die('must not allocate'),
        nextWorkspaceId: Effect.die('must not allocate'),
        nextDelegationId: Effect.die('must not allocate'),
        nextDerivedGrantId: Effect.die('must not allocate'),
        now: Effect.die('must not read time'),
      }),
      Layer.succeed(SessionLifecyclePreparationService, {
        prepare: () => Effect.die('must not prepare'),
        discard: () => Effect.die('must not discard'),
        commit: () => Effect.die('must not commit'),
        recoverPending: Effect.die('must not recover'),
      }),
      Layer.succeed(SessionLifecycleRepository, {
        findReplay: () => Effect.succeed(replay),
        execute: () => Effect.die('must not persist'),
      }),
    )

    await expect(
      Effect.runPromise(
        executeSessionLifecycle({ callerId: 'local-user', request }).pipe(Effect.provide(layer)),
      ),
    ).resolves.toEqual(replay)
  })

  it('passes one allocated identity set and prepared resource set into atomic persistence', async () => {
    const events: string[] = []
    const layer = Layer.mergeAll(
      identityLayer(),
      Layer.succeed(SessionLifecyclePreparationService, {
        prepare: (input) =>
          Effect.sync(() => {
            events.push(`prepare:${input.identities.sessionId}:${input.identities.runId}`)
            return prepared
          }),
        discard: ({ reason }) => Effect.sync(() => events.push(`discard:${reason}`)),
        commit: () => Effect.void,
        recoverPending: Effect.void,
      }),
      Layer.succeed(SessionLifecycleRepository, {
        execute: (input) =>
          Effect.sync(() => {
            events.push(
              `persist:${input.session.sessionId}:${input.runId}:${input.delegationId}:${input.derivedGrantId}`,
            )
            return {
              contractVersion: 2,
              requestId: request.requestId,
              idempotencyKey: request.idempotencyKey,
              replayed: false,
              outcome: {
                operation: 'spawn',
                effect: 'spawned-worker',
                sessionId: 'session-worker',
                runId: 'run-worker',
                workspaceId: 'workspace-parent',
                parentSessionId: 'session-parent',
                parentRunId: 'run-parent',
                hiveRootSessionId: 'session-parent',
                depth: 1,
                delegationId: 'delegation-worker',
                derivedGrantId: 'grant-worker',
              },
            }
          }),
      }),
    )

    const response = await Effect.runPromise(
      executeSessionLifecycle({ callerId: 'local-user', request }).pipe(Effect.provide(layer)),
    )

    expect(response.outcome.effect).toBe('spawned-worker')
    expect(events).toEqual([
      'prepare:session-worker:run-worker',
      'persist:session-worker:run-worker:delegation-worker:grant-worker',
    ])
  })

  it('discards prepared resources after admission rejection', async () => {
    const discarded: string[] = []
    const layer = Layer.mergeAll(
      identityLayer(),
      Layer.succeed(SessionLifecyclePreparationService, {
        prepare: () => Effect.succeed(prepared),
        discard: ({ reason }) => Effect.sync(() => discarded.push(reason)),
        commit: () => Effect.void,
        recoverPending: Effect.void,
      }),
      Layer.succeed(SessionLifecycleRepository, {
        execute: () =>
          Effect.succeed({
            contractVersion: 2,
            requestId: request.requestId,
            idempotencyKey: request.idempotencyKey,
            replayed: false,
            outcome: {
              operation: 'spawn',
              effect: 'rejected',
              code: 'parent_capacity_reached',
              retryable: true,
              parentConcurrencyLimit: 4,
              parentRunningChildren: 4,
            },
          }),
      }),
    )

    await Effect.runPromise(
      executeSessionLifecycle({ callerId: 'local-user', request }).pipe(Effect.provide(layer)),
    )

    expect(discarded).toEqual(['rejected'])
  })

  it('discards prepared resources when persistence fails', async () => {
    const discarded: string[] = []
    const layer = Layer.mergeAll(
      identityLayer(),
      Layer.succeed(SessionLifecyclePreparationService, {
        prepare: () => Effect.succeed(prepared),
        discard: ({ reason }) => Effect.sync(() => discarded.push(reason)),
        commit: () => Effect.void,
        recoverPending: Effect.void,
      }),
      Layer.succeed(SessionLifecycleRepository, {
        execute: () =>
          Effect.fail(new SessionLifecycleRepositoryError({ operation: 'execute-lifecycle' })),
      }),
    )

    const error = await Effect.runPromise(
      executeSessionLifecycle({ callerId: 'local-user', request })
        .pipe(Effect.flip)
        .pipe(Effect.provide(layer)),
    )

    expect(error).toMatchObject({
      _tag: 'SessionLifecycleRepositoryError',
      operation: 'execute-lifecycle',
    })
    expect(discarded).toEqual(['repository-failure'])
  })
})
