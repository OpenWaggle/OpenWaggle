import { SessionId } from '@shared/types/brand'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import type { SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import {
  clearAgentLoopInteractionBrokerForTests,
  requestAgentLoopInteraction,
} from '../agent-loop-interaction-broker'
import { dispatchSessionRequestsListQuery } from '../local-session-query-dispatcher'

const WORKER_ID = SessionId('worker')
const requestPayload = {
  contract: 'session-query-v2',
  request: {
    contractVersion: 2,
    requestId: 'requests-list',
    query: { operation: 'requests-list', sessionId: WORKER_ID },
  },
} satisfies LocalSessionCommandPayload

function caller(input: {
  readonly baseCapabilities: readonly SessionCapability[]
  readonly derivedCapabilities: readonly SessionCapability[]
}): LocalSessionCallerIdentity {
  return {
    callerId: 'profile:restricted',
    baseProfileScope: { sessionIds: ['queen'] },
    profileAuthority: {
      profileId: 'restricted',
      profileName: 'restricted',
      capabilities: input.baseCapabilities,
      scope: { sessionIds: ['queen'] },
      authorizationCeiling: 'ask-for-approval',
    },
    derivedSessionAuthorities: [
      {
        sessionId: WORKER_ID,
        capabilities: input.derivedCapabilities,
        authorizationCeiling: 'ask-for-approval',
      },
    ],
  }
}

function targetLayer() {
  return Layer.succeed(SessionAuthorizationTargetRepository, {
    resolve: (sessionId) =>
      Effect.succeed({
        sessionId,
        projectPath: '/project',
        hiveRootSessionId: 'queen',
        authorizationCeiling: 'ask-for-approval' as const,
      }),
    resolveDelegation: () => Effect.die('Delegations are not used in this test.'),
    listLiveDerivedAuthorities: () => Effect.succeed([]),
  })
}

function listRequests(identity: LocalSessionCallerIdentity) {
  if (requestPayload.contract !== 'session-query-v2') throw new Error('Expected Session query.')
  return Effect.runPromise(
    dispatchSessionRequestsListQuery(identity, requestPayload).pipe(Effect.provide(targetLayer())),
  )
}

describe('requests-list derived authority', () => {
  beforeEach(() => {
    clearAgentLoopInteractionBrokerForTests()
    void requestAgentLoopInteraction({
      interaction: {
        interactionId: 'input-1',
        sessionId: WORKER_ID,
        runId: 'run-worker',
        kind: 'input',
        source: 'pi-ui',
        createdAt: 1,
        title: 'Worker input',
      },
      onEvent: () => undefined,
    })
  })

  afterEach(() => clearAgentLoopInteractionBrokerForTests())

  it('does not combine base response capability with a derived read-only target', async () => {
    const result = await listRequests(
      caller({
        baseCapabilities: ['sessions:read', 'sessions:respond'],
        derivedCapabilities: ['sessions:read'],
      }),
    )

    expect(result.response.outcome).toMatchObject({ operation: 'requests-list', requests: [] })
  })

  it('lists a request when the exact derived target also grants response capability', async () => {
    const result = await listRequests(
      caller({
        baseCapabilities: ['sessions:read'],
        derivedCapabilities: ['sessions:read', 'sessions:respond'],
      }),
    )

    expect(result.response.outcome).toMatchObject({
      operation: 'requests-list',
      requests: [{ interactionId: 'input-1', sessionId: WORKER_ID }],
    })
  })
})
