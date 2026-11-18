import { RunId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRunResult } from '../../application/agent-run/types'
import { SessionControlRepositoryError } from '../../errors'
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
import type {
  PendingSessionOrchestrationUpdate,
  SessionOrchestrationUpdateRepositoryShape,
} from '../../ports/session-orchestration-update-repository'
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
  executeAgentRunMock: vi.fn<
    (_input: {
      readonly onEvent: (event: AgentTransportEvent) => void
    }) => Effect.Effect<AgentRunResult>
  >((_input: { readonly onEvent: (event: AgentTransportEvent) => void }) =>
    Effect.succeed(fromPartial<AgentRunResult>({ outcome: 'success', newMessages: [] })),
  ),
  publishSessionHostEventMock: vi.fn(),
}))

vi.mock('../../application/agent-run-service', () => ({
  executeAgentRun: executeAgentRunMock,
}))

vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: publishSessionHostEventMock,
  tryGetSessionHostEventRuntime: () => undefined,
}))

import { executeRegisteredRun } from '../session-control-run-dispatch'

function testLayer(
  runIfRequested: AgentRequestedWaggleServiceShape['runIfRequested'],
  listPending: SessionOrchestrationUpdateRepositoryShape['listPending'] = vi
    .fn<SessionOrchestrationUpdateRepositoryShape['listPending']>()
    // Nothing is pending when the classic Run starts; one update arrives in its final turn.
    .mockReturnValueOnce(Effect.succeed([]))
    .mockReturnValue(Effect.succeed([lateUpdate])),
) {
  return Layer.mergeAll(
    Layer.succeed(
      SessionControlAttachmentService,
      fromPartial<SessionControlAttachmentServiceShape>({ resolve: () => Effect.succeed([]) }),
    ),
    Layer.succeed(
      AgentRequestedWaggleService,
      fromPartial<AgentRequestedWaggleServiceShape>({ runIfRequested }),
    ),
    Layer.succeed(
      SessionReportRepository,
      fromPartial<SessionReportRepositoryShape>({
        listPending: () => Effect.succeed([pendingReport]),
        markDelivered: () => Effect.void,
      }),
    ),
    Layer.succeed(
      SessionOrchestrationUpdateRepository,
      fromPartial<SessionOrchestrationUpdateRepositoryShape>({
        listPending,
        markDelivered: markOrchestrationDelivered,
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

const markOrchestrationDelivered = vi.fn<
  SessionOrchestrationUpdateRepositoryShape['markDelivered']
>(() => Effect.void)

const lateUpdate = fromPartial<PendingSessionOrchestrationUpdate>({
  updateId: 'update-late',
  delegationId: 'delegation-1',
})

const pendingReport = {
  reportId: 'report-1',
  correlationId: 'correlation-1',
  sourceSessionId: 'session-peer',
  authoredBy: 'session-agent:session-peer:run-peer',
  content: 'Peer context.',
  requestReply: false,
  createdAt: 1,
}

const registeredRun: Parameters<typeof executeRegisteredRun>[0] = {
  request: {
    sessionId: SessionId('session-1'),
    runId: RunId('run-classic'),
    controller: new AbortController(),
    intent: {
      text: 'Review it.',
      attachmentIds: [],
      // An ask-for-approval CLI profile queued this Run on a yolo Session.
      callerId: 'profile:asker',
      runAuthorizationOverride: 'ask-for-approval',
      acceptedAt: 1,
      idempotencyKey: 'requested-waggle',
    },
  },
  execution: {
    model: SupportedModelId('openrouter/anthropic/claude-haiku-4.5'),
    authorizationCeiling: 'yolo',
    sessionCapabilities: ['sessions:read'],
    toolAllowlist: ['read'],
    projectPath: '/tmp/project',
    identityContext: '',
    runIdentityContext: '',
  },
  controller: new AbortController(),
  allowModelMultiAgent: false,
}

describe('agent-requested Waggle after a classic Run', () => {
  beforeEach(() => {
    publishSessionHostEventMock.mockReset()
    markOrchestrationDelivered.mockClear()
  })

  it('hands the classic Run authorization context and still-pending updates to the Waggle', async () => {
    const runIfRequested = vi.fn<AgentRequestedWaggleServiceShape['runIfRequested']>(() =>
      Effect.succeed(false),
    )

    await Effect.runPromise(
      executeRegisteredRun(registeredRun).pipe(Effect.provide(testLayer(runIfRequested))),
    )

    expect(runIfRequested).toHaveBeenCalledTimes(1)
    const [request] = runIfRequested.mock.calls[0] ?? []
    expect(request).toMatchObject({
      runId: 'run-classic',
      authority: {
        authorityCallerId: 'profile:asker',
        runAuthorizationOverride: 'ask-for-approval',
        toolAllowlist: ['read'],
        sessionCapabilities: ['sessions:read'],
      },
    })
    // An update the classic Run's final turn put on the branch is still pending: the Waggle's
    // first model request sees it, so the parent is not woken for an update it already read.
    expect(request?.authority?.orchestrationUpdates).toEqual([lateUpdate])
    // The Waggle acknowledges them as the classic Run, the one with a Run row.
    request?.authority?.onOrchestrationUpdatesDelivered?.(['update-late'])
    await vi.waitFor(() =>
      expect(markOrchestrationDelivered).toHaveBeenCalledWith(
        expect.objectContaining({
          updateIds: ['update-late'],
          parentSessionId: 'session-1',
          runId: 'run-classic',
        }),
      ),
    )
    // The classic Run already delivered these; passing them again would deliver them twice.
    for (const key of [
      'peerAgentReports',
      'onPeerAgentReportsDelivered',
      'delegationSpecificationUpdates',
      'onDelegationSpecificationUpdatesDelivered',
    ]) {
      expect(request?.authority).not.toHaveProperty(key)
    }
  })

  it('still succeeds when the updates still pending cannot be read', async () => {
    const runIfRequested = vi.fn<AgentRequestedWaggleServiceShape['runIfRequested']>(() =>
      Effect.succeed(false),
    )
    const listPending = vi
      .fn<SessionOrchestrationUpdateRepositoryShape['listPending']>()
      .mockReturnValueOnce(Effect.succeed([]))
      .mockReturnValue(
        Effect.fail(
          new SessionControlRepositoryError({ operation: 'list-pending', cause: 'busy' }),
        ),
      )

    const ran = await Effect.runPromise(
      executeRegisteredRun(registeredRun).pipe(
        Effect.provide(testLayer(runIfRequested, listPending)),
      ),
    )

    expect(ran.result).toMatchObject({ outcome: 'success' })
    expect(runIfRequested.mock.calls[0]?.[0].authority?.orchestrationUpdates).toEqual([])
  })
})
