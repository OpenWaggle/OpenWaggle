import type { WorktreeLaunchProgress } from '@shared/types/background-run'
import { RunId, SessionId, SupportedModelId } from '@shared/types/brand'
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
      readonly onWorktreeLaunch?: (progress: WorktreeLaunchProgress) => void
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

describe('Session Control worktree progress', () => {
  beforeEach(() => {
    publishSessionHostEventMock.mockReset()
    executeAgentRunMock.mockClear()
  })
  it('publishes classic run worktree progress through the Session Host', async () => {
    const sessionId = SessionId('session-1')
    const model = SupportedModelId('openai/gpt-5')

    await Effect.runPromise(
      executeRegisteredRun({
        request: {
          sessionId,
          runId: RunId('run-1'),
          controller: new AbortController(),
          intent: {
            text: 'Start from this branch.',
            attachmentIds: [],
            callerId: 'local-user',
            acceptedAt: 1,
            idempotencyKey: 'worktree-progress',
          },
        },
        execution: {
          model,
          thinkingLevel: 'high',
          authorizationCeiling: 'yolo',
          sessionCapabilities: [],
          projectPath: '/tmp/project',
          identityContext: '',
        },
        controller: new AbortController(),
        allowModelMultiAgent: false,
      }).pipe(Effect.provide(testLayer())),
    )

    const runInput = executeAgentRunMock.mock.calls[0]?.[0]
    runInput?.onWorktreeLaunch?.({
      stage: 'checking-out-files',
      details: ['Creating ow/session-1 from feature/source'],
    })

    expect(publishSessionHostEventMock).toHaveBeenCalledWith({
      kind: 'session-worktree-launch',
      sessionId,
      model,
      mode: 'classic',
      event: {
        type: 'progress',
        progress: {
          stage: 'checking-out-files',
          details: ['Creating ow/session-1 from feature/source'],
        },
      },
    })
  })

  it('does not invent a worktree failure when a run fails before worktree setup', async () => {
    executeAgentRunMock.mockReturnValueOnce(
      Effect.succeed({
        outcome: 'error',
        message: 'Provider unavailable',
        code: 'provider-unavailable',
      }),
    )

    await Effect.runPromise(
      executeRegisteredRun({
        request: {
          sessionId: SessionId('session-1'),
          runId: RunId('run-1'),
          controller: new AbortController(),
          intent: {
            text: 'Hello.',
            attachmentIds: [],
            callerId: 'local-user',
            acceptedAt: 1,
            idempotencyKey: 'no-worktree',
          },
        },
        execution: {
          model: SupportedModelId('openai/gpt-5'),
          thinkingLevel: 'high',
          authorizationCeiling: 'yolo',
          sessionCapabilities: [],
          projectPath: '/tmp/project',
          identityContext: '',
        },
        controller: new AbortController(),
        allowModelMultiAgent: false,
      }).pipe(Effect.provide(testLayer())),
    )

    expect(publishSessionHostEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'session-worktree-launch' }),
    )
  })
})
