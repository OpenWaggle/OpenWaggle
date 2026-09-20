import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepositoryError } from '../../errors'
import { AgentKernelService, type AgentKernelServiceShape } from '../../ports/agent-kernel-service'
import { ProviderService, type ProviderServiceShape } from '../../ports/provider-service'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../../ports/session-projection-repository'
import {
  type PersistSessionSnapshotInput,
  SessionRepository,
  type SessionRepositoryShape,
} from '../../ports/session-repository'
import { SettingsService, type SettingsServiceShape } from '../../services/settings-service'
import { executeAgentRun } from '../agent-run-service'
import {
  runServiceKernelResult,
  runServiceSession,
  runServiceSessionId,
  runServiceSessionTree,
} from './agent-run-service.test-utils'
import { EmptyExtensionRuntimeLayer } from './extension-runtime-test-layer'

const model = SupportedModelId('openai/gpt-5.4')
const persistSnapshotMock = vi.fn()
let treeReadCount = 0

const TestLayer = Layer.mergeAll(
  Layer.succeed(
    SessionProjectionRepository,
    SessionProjectionRepository.of(
      fromPartial<SessionProjectionRepositoryShape>({
        getOptional: () => Effect.succeed(runServiceSession),
        setTurnCheckpointAnchor: () => Effect.void,
      }),
    ),
  ),
  Layer.succeed(
    ProviderService,
    ProviderService.of(
      fromPartial<ProviderServiceShape>({
        isKnownModel: () => Effect.succeed(true),
      }),
    ),
  ),
  Layer.succeed(
    SettingsService,
    SettingsService.of(
      fromPartial<SettingsServiceShape>({
        get: () => Effect.succeed(DEFAULT_SETTINGS),
      }),
    ),
  ),
  Layer.succeed(
    SessionRepository,
    SessionRepository.of(
      fromPartial<SessionRepositoryShape>({
        getTree: () => {
          treeReadCount += 1
          return treeReadCount === 3
            ? Effect.fail(
                new SessionProjectionRepositoryError({
                  operation: 'get-tree',
                  cause: new Error('database temporarily unavailable'),
                }),
              )
            : Effect.succeed(runServiceSessionTree)
        },
        clearInterruptedRuns: () => Effect.void,
        recordActiveRun: () => Effect.void,
        persistSnapshot: (input: PersistSessionSnapshotInput) =>
          Effect.sync(() => {
            persistSnapshotMock(input)
          }),
        clearActiveRun: () => Effect.void,
      }),
    ),
  ),
  Layer.succeed(
    AgentKernelService,
    AgentKernelService.of(
      fromPartial<AgentKernelServiceShape>({
        run: () => Effect.succeed(runServiceKernelResult(model)),
      }),
    ),
  ),
  EmptyExtensionRuntimeLayer,
)

describe('executeAgentRun resource provenance', () => {
  beforeEach(() => {
    treeReadCount = 0
    persistSnapshotMock.mockReset()
  })

  it('keeps a persisted run successful when the provenance refresh fails', async () => {
    const result = await Effect.runPromise(
      executeAgentRun({
        sessionId: runServiceSessionId,
        runId: 'run-provenance-read-failure',
        payload: { text: 'Implement the next slice', thinkingLevel: 'medium', attachments: [] },
        model,
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result).toMatchObject({
      outcome: 'success',
      resourceMessages: [],
      resourceNodeIds: {},
      resourceBranchIds: {},
    })
    expect(persistSnapshotMock).toHaveBeenCalledOnce()
    expect(treeReadCount).toBe(3)
  })
})
