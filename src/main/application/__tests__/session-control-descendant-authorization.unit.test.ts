import { RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import type { SessionControlSessionState } from '../../domain/session-control/message-aggregate'
import {
  type AgentRunInterruptionInput,
  AgentRunInterruptionService,
} from '../../ports/agent-run-interruption-service'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { SessionDescendantRunRepository } from '../../ports/session-descendant-run-repository'
import { interruptSessionDescendants } from '../session-control-external-service'

describe('Session descendant interruption authorization', () => {
  it('interrupts deepest active descendants explicitly without interrupting the parent', async () => {
    const states = new Map<string, SessionControlSessionState>([
      [
        'queen',
        {
          sessionId: SessionId('queen'),
          revision: 3,
          run: { state: 'active', runId: RunId('run-queen') },
          followUpQueue: { state: 'running', revision: 0, items: [] },
        },
      ],
      [
        'worker',
        {
          sessionId: SessionId('worker'),
          revision: 4,
          run: { state: 'active', runId: RunId('run-worker') },
          followUpQueue: { state: 'running', revision: 0, items: [] },
        },
      ],
      [
        'grandchild',
        {
          sessionId: SessionId('grandchild'),
          revision: 5,
          run: { state: 'active', runId: RunId('run-grandchild') },
          followUpQueue: { state: 'running', revision: 0, items: [] },
        },
      ],
    ])
    const interrupt = vi.fn((_input: AgentRunInterruptionInput) => ({ accepted: true as const }))
    const layer = Layer.mergeAll(
      Layer.succeed(SessionDescendantRunRepository, {
        listActive: () =>
          Effect.succeed([
            { sessionId: 'grandchild', runId: 'run-grandchild', depth: 2 },
            { sessionId: 'worker', runId: 'run-worker', depth: 1 },
          ]),
      }),
      Layer.succeed(AgentRunInterruptionService, {
        interrupt: (input) => Effect.succeed(interrupt(input)),
      }),
      Layer.succeed(SessionAuthorizationTargetRepository, {
        resolve: () => Effect.die('unrestricted callers do not resolve authorization targets'),
        resolveDelegation: () =>
          Effect.die('unrestricted callers do not resolve authorization targets'),
        listLiveDerivedAuthorities: () => Effect.succeed([]),
      }),
      Layer.succeed(SessionControlOperationJournal, {
        claim: (input) =>
          Effect.sync(() => {
            const state = states.get(input.request.command.sessionId)
            if (!state) throw new Error('Missing test state.')
            const decision = input.decide(state)
            if (!decision.accepted) {
              return { status: 'completed', replayed: false, outcome: decision.outcome } as const
            }
            const next = decision.state ?? state
            states.set(input.request.command.sessionId, next)
            return { status: 'claimed', stateRevision: next.revision } as const
          }),
        complete: () => Effect.void,
      }),
    )

    const response = await Effect.runPromise(
      interruptSessionDescendants({
        callerId: 'queen-agent',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'stop-hive',
          idempotencyKey: 'stop-hive-once',
          command: { operation: 'interrupt-descendants', sessionId: 'queen' },
        },
      }).pipe(Effect.provide(layer)),
    )

    expect(interrupt.mock.calls).toEqual([
      [{ sessionId: 'grandchild', runId: 'run-grandchild' }],
      [{ sessionId: 'worker', runId: 'run-worker' }],
    ])
    expect(states.get('queen')?.run).toEqual({ state: 'active', runId: RunId('run-queen') })
    expect(response.outcome).toMatchObject({
      operation: 'interrupt-descendants',
      effect: 'descendant-interruptions-requested',
      interrupted: [
        { sessionId: 'grandchild', runId: 'run-grandchild', stateRevision: 6 },
        { sessionId: 'worker', runId: 'run-worker', stateRevision: 5 },
      ],
    })
  })

  it('authorizes every active descendant before claiming or interrupting any Run', async () => {
    const claim = vi.fn(() => Effect.die('must not claim'))
    const interrupt = vi.fn(() => Effect.succeed({ accepted: true as const }))
    const target = (sessionId: string) => ({
      sessionId,
      projectPath: '/project',
      hiveRootSessionId: 'queen',
      authorizationCeiling: 'ask-for-approval' as const,
    })
    const layer = Layer.mergeAll(
      Layer.succeed(SessionDescendantRunRepository, {
        listActive: () =>
          Effect.succeed([
            { sessionId: 'grandchild', runId: 'run-grandchild', depth: 2 },
            { sessionId: 'worker', runId: 'run-worker', depth: 1 },
          ]),
      }),
      Layer.succeed(SessionAuthorizationTargetRepository, {
        resolve: (sessionId) => Effect.succeed(target(sessionId)),
        resolveDelegation: () => Effect.succeed(target('worker')),
        listLiveDerivedAuthorities: () => Effect.succeed([]),
      }),
      Layer.succeed(SessionControlOperationJournal, { claim, complete: () => Effect.void }),
      Layer.succeed(AgentRunInterruptionService, { interrupt }),
    )

    const error = await Effect.runPromise(
      interruptSessionDescendants({
        callerId: 'profile:restricted',
        caller: {
          callerId: 'profile:restricted',
          profileAuthority: {
            profileId: 'restricted',
            profileName: 'restricted',
            capabilities: ['sessions:interrupt'],
            scope: { sessionIds: ['worker'] },
            authorizationCeiling: 'ask-for-approval',
          },
        },
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: 'stop-partial-hive',
          idempotencyKey: 'stop-partial-hive-once',
          command: { operation: 'interrupt-descendants', sessionId: 'queen' },
        },
      }).pipe(Effect.provide(layer), Effect.flip),
    )

    expect(error).toMatchObject({ code: 'target_scope_denied' })
    expect(claim).not.toHaveBeenCalled()
    expect(interrupt).not.toHaveBeenCalled()
  })
})
