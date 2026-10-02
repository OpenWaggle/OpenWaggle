import { RunId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRunResult } from '../../application/agent-run/types'
import type { AgentKernelServiceShape } from '../../ports/agent-kernel-service'
import { AgentKernelService } from '../../ports/agent-kernel-service'
import type { AgentRequestedWaggleServiceShape } from '../../ports/agent-requested-waggle-service'
import { AgentRequestedWaggleService } from '../../ports/agent-requested-waggle-service'
import type { ExtensionLifecycleRepositoryShape } from '../../ports/extension-lifecycle-repository'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import type { ExtensionManagerServiceShape } from '../../ports/extension-manager-service'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import type { ExtensionProjectOverridesRepositoryShape } from '../../ports/extension-project-overrides-repository'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import type { ProviderServiceShape } from '../../ports/provider-service'
import { ProviderService } from '../../ports/provider-service'
import type { SessionControlAttachmentServiceShape } from '../../ports/session-control-attachment-service'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import type { SessionOrchestrationUpdateRepositoryShape } from '../../ports/session-orchestration-update-repository'
import { SessionOrchestrationUpdateRepository } from '../../ports/session-orchestration-update-repository'
import type { SessionProjectionRepositoryShape } from '../../ports/session-projection-repository'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import type { SessionReportRepositoryShape } from '../../ports/session-report-repository'
import { SessionReportRepository } from '../../ports/session-report-repository'
import type { SessionRepositoryShape } from '../../ports/session-repository'
import { SessionRepository } from '../../ports/session-repository'
import type { SettingsServiceShape } from '../../services/settings-service'
import { SettingsService } from '../../services/settings-service'

const { executeAgentRunMock, publishSessionHostEventMock } = vi.hoisted(() => ({
  executeAgentRunMock: vi.fn(
    (_input: {
      readonly onEvent: (event: AgentTransportEvent) => void
    }): Effect.Effect<AgentRunResult> => Effect.succeed({ outcome: 'aborted' as const }),
  ),
  publishSessionHostEventMock: vi.fn(),
}))

vi.mock('../../application/agent-run-service', () => ({
  executeAgentRun: executeAgentRunMock,
}))

vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: publishSessionHostEventMock,
}))

import { executeRegisteredRun } from '../session-control-run-dispatch'

function testLayer() {
  return Layer.mergeAll(
    Layer.succeed(
      SessionControlAttachmentService,
      fromPartial<SessionControlAttachmentServiceShape>({ resolve: () => Effect.succeed([]) }),
    ),
    Layer.succeed(
      AgentRequestedWaggleService,
      fromPartial<AgentRequestedWaggleServiceShape>({
        runIfRequested: () => Effect.succeed(false),
      }),
    ),
    Layer.succeed(
      SessionReportRepository,
      fromPartial<SessionReportRepositoryShape>({ listPending: () => Effect.succeed([]) }),
    ),
    Layer.succeed(
      SessionOrchestrationUpdateRepository,
      fromPartial<SessionOrchestrationUpdateRepositoryShape>({
        listPending: () => Effect.succeed([]),
        listPendingSpecifications: () => Effect.succeed([]),
      }),
    ),
    Layer.succeed(AgentKernelService, fromPartial<AgentKernelServiceShape>({})),
    Layer.succeed(ExtensionLifecycleRepository, fromPartial<ExtensionLifecycleRepositoryShape>({})),
    Layer.succeed(ExtensionManagerService, fromPartial<ExtensionManagerServiceShape>({})),
    Layer.succeed(
      ExtensionProjectOverridesRepository,
      fromPartial<ExtensionProjectOverridesRepositoryShape>({}),
    ),
    Layer.succeed(ProviderService, fromPartial<ProviderServiceShape>({})),
    Layer.succeed(SessionProjectionRepository, fromPartial<SessionProjectionRepositoryShape>({})),
    Layer.succeed(SessionRepository, fromPartial<SessionRepositoryShape>({})),
    Layer.succeed(SettingsService, fromPartial<SettingsServiceShape>({})),
  )
}

const sessionId = SessionId('session-1')
const model = SupportedModelId('openrouter/anthropic/claude-haiku-4.5')

function runOnce() {
  return Effect.runPromise(
    executeRegisteredRun({
      request: {
        sessionId,
        runId: RunId('run-1'),
        controller: new AbortController(),
        intent: {
          text: 'Reply with OK.',
          attachmentIds: [],
          callerId: 'local-user',
          acceptedAt: 1,
          idempotencyKey: 'terminal-event',
        },
      },
      execution: {
        model,
        authorizationCeiling: 'yolo',
        sessionCapabilities: [],
        projectPath: '/tmp/project',
        identityContext: '',
      },
      controller: new AbortController(),
      allowModelMultiAgent: false,
    }).pipe(Effect.provide(testLayer())),
  )
}

function publishedAgentEnds() {
  return publishSessionHostEventMock.mock.calls
    .map(([payload]) => payload)
    .filter((payload) => payload.kind === 'session-transport' && payload.event.type === 'agent_end')
    .map((payload) => payload.event)
}

const PI_ERROR_END = {
  type: 'agent_end',
  runId: 'run-1',
  reason: 'error',
  error: { message: 'This request requires more credits.', code: 'insufficient-credits' },
  timestamp: 1,
} as const satisfies AgentTransportEvent

describe('Session Control run terminal event', () => {
  beforeEach(() => {
    publishSessionHostEventMock.mockReset()
    executeAgentRunMock.mockReset()
  })

  // Pi's agent_end already told clients the Run failed; a second one used to follow it.
  it('publishes one agent_end when Pi already ended the Run with its error', async () => {
    executeAgentRunMock.mockImplementation((input) => {
      input.onEvent(PI_ERROR_END)
      return Effect.succeed({
        outcome: 'error' as const,
        message: 'This request requires more credits.',
        code: 'insufficient-credits',
        transportEmitted: true,
      })
    })

    const result = await runOnce()

    expect(publishedAgentEnds()).toEqual([PI_ERROR_END])
    expect(result).toMatchObject({ terminalEventAt: expect.any(Number) })
    expect(result).not.toHaveProperty('failure')
  })

  it('ends a Run Pi never started with the Host failure', async () => {
    executeAgentRunMock.mockImplementation(() =>
      Effect.succeed({
        outcome: 'invalid-model' as const,
        message: 'Model is not available.',
        code: 'invalid-model',
      }),
    )

    const result = await runOnce()

    expect(publishedAgentEnds()).toEqual([
      expect.objectContaining({
        reason: 'error',
        error: { message: 'Model is not available.', code: 'invalid-model' },
      }),
    ])
    expect(result).toMatchObject({ terminalEventAt: expect.any(Number) })
  })

  /*
   * Pi ended the Run cleanly, then saving it failed. Its agent_end is the terminal event, so the
   * failure is reported with the settlement instead of as a second agent_end.
   */
  it('reports a failure found after a clean agent_end with the settlement', async () => {
    executeAgentRunMock.mockImplementation((input) => {
      input.onEvent({ type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 1 })
      return Effect.succeed({
        outcome: 'error' as const,
        message: 'Could not save.',
        code: 'persist-failed',
        transportEmitted: true,
      })
    })

    const result = await runOnce()

    expect(publishedAgentEnds()).toEqual([
      { type: 'agent_end', runId: 'run-1', reason: 'stop', timestamp: 1 },
    ])
    expect(result).toMatchObject({ failure: { code: 'persist-failed' } })
  })

  it('does not treat a retried agent_end as the end of the Run', async () => {
    executeAgentRunMock.mockImplementation((input) => {
      input.onEvent({ ...PI_ERROR_END, willRetry: true })
      return Effect.succeed({
        outcome: 'error' as const,
        message: 'Retry cancelled.',
        code: 'unknown',
        transportEmitted: true,
      })
    })

    const result = await runOnce()

    expect(publishedAgentEnds()).toHaveLength(2)
    expect(publishedAgentEnds()[1]).toMatchObject({ reason: 'error' })
    expect(result).toMatchObject({ terminalEventAt: expect.any(Number) })
  })
})
