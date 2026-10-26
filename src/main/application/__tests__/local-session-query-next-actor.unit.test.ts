import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionQueryRepositoryShape } from '../../ports/session-query-repository'
import {
  clearAgentLoopInteractionBrokerForTests,
  requestAgentLoopInteraction,
} from '../agent-loop-interaction-broker'
import { dispatchSessionRepositoryQuery } from '../local-session-query-dispatcher'
import {
  type LiveProfile,
  LOCAL_USER_CALLER,
  PROJECT_A,
  payload,
  searchResponse,
  testLayer,
} from './local-session-command-search-authorization.test-support'

const liveProfile: LiveProfile = {
  capabilities: ['sessions:discover', 'sessions:read'],
  scope: { projectPaths: [PROJECT_A] },
  authorizationCeiling: 'yolo',
  revokedAt: null,
}

function park(sessionId: string, interaction: 'approval' | 'question') {
  void requestAgentLoopInteraction({
    interaction:
      interaction === 'approval'
        ? {
            interactionId: `${sessionId}-approval`,
            sessionId: SessionId(sessionId),
            runId: 'run',
            kind: 'confirm',
            source: 'pi-ui',
            createdAt: 1,
            title: 'Run a command?',
            message: 'pnpm test',
            purpose: 'authorization',
          }
        : {
            interactionId: `${sessionId}-question`,
            sessionId: SessionId(sessionId),
            runId: 'run',
            kind: 'input',
            source: 'pi-ui',
            createdAt: 2,
            title: 'Which branch?',
          },
    onEvent: () => undefined,
  }).catch(() => undefined)
}

describe('Session queries carry who acts next (#380)', () => {
  afterEach(() => {
    clearAgentLoopInteractionBrokerForTests()
  })

  it('hands the Host’s parked requests to the repository, approval over question', async () => {
    park('worker-a', 'question')
    park('worker-a', 'approval')
    park('worker-b', 'question')
    const execute = vi.fn<SessionQueryRepositoryShape['execute']>(() =>
      Effect.succeed(searchResponse(payload.request.requestId, 'project-a', PROJECT_A)),
    )
    await Effect.runPromise(
      dispatchSessionRepositoryQuery(LOCAL_USER_CALLER, payload).pipe(
        Effect.provide(testLayer(liveProfile, { execute })),
      ),
    )
    const pending = execute.mock.calls[0]?.[0].pendingRequests
    expect(pending && Object.fromEntries(pending)).toEqual({
      'worker-a': 'approval',
      'worker-b': 'question',
    })
  })
})
