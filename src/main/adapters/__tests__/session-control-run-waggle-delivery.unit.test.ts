import { RunId, SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { AgentKernelService, type AgentKernelServiceShape } from '../../ports/agent-kernel-service'
import {
  AgentRequestedWaggleService,
  type AgentRequestedWaggleServiceShape,
} from '../../ports/agent-requested-waggle-service'
import {
  ExtensionLifecycleRepository,
  type ExtensionLifecycleRepositoryShape,
} from '../../ports/extension-lifecycle-repository'
import {
  ExtensionManagerService,
  type ExtensionManagerServiceShape,
} from '../../ports/extension-manager-service'
import {
  ExtensionProjectOverridesRepository,
  type ExtensionProjectOverridesRepositoryShape,
} from '../../ports/extension-project-overrides-repository'
import { ProviderService, type ProviderServiceShape } from '../../ports/provider-service'
import {
  SessionControlAttachmentService,
  type SessionControlAttachmentServiceShape,
} from '../../ports/session-control-attachment-service'
import {
  SessionOrchestrationUpdateRepository,
  type SessionOrchestrationUpdateRepositoryShape,
} from '../../ports/session-orchestration-update-repository'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../../ports/session-projection-repository'
import {
  SessionReportRepository,
  type SessionReportRepositoryShape,
} from '../../ports/session-report-repository'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import { SettingsService, type SettingsServiceShape } from '../../services/settings-service'

const { runRegisteredExplicitWaggle } = vi.hoisted(() => ({
  runRegisteredExplicitWaggle: vi.fn(() =>
    Effect.succeed({ outcome: 'success' as const, newMessages: [] }),
  ),
}))

vi.mock('../../application/explicit-waggle-command-runner', () => ({
  runRegisteredExplicitWaggle,
}))

import { executeRegisteredRun } from '../session-control-run-dispatch'

describe('Session Control queued Waggle delivery', () => {
  it('runs the preserved hive and applies the Session execution authority', async () => {
    const attachments = fromPartial<SessionControlAttachmentServiceShape>({
      resolve: () => Effect.succeed([]),
    })
    const requestedWaggle = fromPartial<AgentRequestedWaggleServiceShape>({
      runIfRequested: () => Effect.succeed(false),
    })
    const reports = fromPartial<SessionReportRepositoryShape>({
      listPending: () => Effect.succeed([]),
    })
    const orchestration = fromPartial<SessionOrchestrationUpdateRepositoryShape>({
      listPending: () => Effect.succeed([]),
      listPendingSpecifications: () => Effect.succeed([]),
    })
    const layer = Layer.mergeAll(
      Layer.succeed(SessionControlAttachmentService, attachments),
      Layer.succeed(AgentRequestedWaggleService, requestedWaggle),
      Layer.succeed(SessionReportRepository, reports),
      Layer.succeed(SessionOrchestrationUpdateRepository, orchestration),
      Layer.succeed(AgentKernelService, fromPartial<AgentKernelServiceShape>({})),
      Layer.succeed(
        ExtensionLifecycleRepository,
        fromPartial<ExtensionLifecycleRepositoryShape>({}),
      ),
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
    const config = {
      mode: 'sequential' as const,
      agents: [
        {
          label: 'Builder',
          model: '$inherit' as const,
          roleDescription: 'Implements',
          color: 'blue' as const,
        },
        {
          label: 'Reviewer',
          model: SupportedModelId('openai/gpt-5'),
          roleDescription: 'Reviews',
          color: 'amber' as const,
        },
      ] as const,
      stop: { primary: 'consensus' as const, maxTurnsSafety: 4 },
    }

    const result = await Effect.runPromise(
      executeRegisteredRun({
        request: {
          sessionId: SessionId('session-1'),
          runId: RunId('run-1'),
          controller: new AbortController(),
          intent: {
            text: 'Review next.',
            attachmentIds: [],
            waggle: {
              presetId: 'preset-review',
              presetName: 'Review pair',
              source: 'user',
              config,
            },
            runAuthorizationOverride: 'yolo',
            callerId: 'profile:cli',
            acceptedAt: 1,
            idempotencyKey: 'queued-waggle',
          },
        },
        execution: {
          model: SupportedModelId('openai/gpt-5'),
          thinkingLevel: 'high',
          authorizationCeiling: 'ask-for-approval',
          agentInstructions: 'Read-only reviewer.',
          toolAllowlist: ['read'],
          skillAllowlist: ['code-review'],
          mcpServerAllowlist: ['github'],
          sessionCapabilities: [],
          projectPath: '/tmp/project',
          identityContext: 'Worker in the release hive.',
        },
        controller: new AbortController(),
        allowModelMultiAgent: false,
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      mode: 'waggle',
      result: { terminalStatus: 'completed' },
    })
    expect(runRegisteredExplicitWaggle).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        authorityCallerId: 'profile:cli',
        runAuthorizationOverride: 'ask-for-approval',
        agentInstructions: 'Read-only reviewer.',
        sessionIdentityContext: 'Worker in the release hive.',
        toolAllowlist: ['read'],
        skillAllowlist: ['code-review'],
        mcpServerAllowlist: ['github'],
        sessionCapabilities: [],
        modelMultiAgentEnabled: false,
      }),
    )
  })
})
