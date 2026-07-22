import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { MessageId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { SessionNode, SessionTree } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type AgentKernelRunInput, AgentKernelService } from '../../ports/agent-kernel-service'
import { ProviderService } from '../../ports/provider-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { type PersistSessionSnapshotInput, SessionRepository } from '../../ports/session-repository'
import { SettingsService } from '../../services/settings-service'
import { executeAgentRun } from '../agent-run-service'
import {
  runServiceBranchId,
  runServiceSession,
  runServiceSessionId,
  runServiceSessionTree,
} from './agent-run-service.test-utils'
import { EmptyExtensionRuntimeLayer } from './extension-runtime-test-layer'

const runMock = vi.fn()
const persistSnapshotMock = vi.fn<(input: PersistSessionSnapshotInput) => void>()
const sessionId = runServiceSessionId
const branchId = runServiceBranchId
const model = SupportedModelId('openai/gpt-5.4')
const persistedSnapshots: PersistSessionSnapshotInput[] = []
let projectionTree: SessionTree = runServiceSessionTree

const TestSessionProjectionLayer = Layer.succeed(SessionProjectionRepository, {
  get: () => Effect.succeed(runServiceSession),
  getOptional: () => Effect.succeed(runServiceSession),
  list: () => Effect.succeed([]),
  listDetails: () => Effect.succeed([]),
  create: () => Effect.succeed(runServiceSession),
  delete: () => Effect.void,
  archive: () => Effect.void,
  unarchive: () => Effect.void,
  listArchived: () => Effect.succeed([]),
  updateTitle: () => Effect.void,
})

const TestSessionLayer = Layer.succeed(SessionRepository, {
  list: () => Effect.succeed([]),
  listArchivedBranches: () => Effect.succeed([]),
  getTree: () => Effect.succeed(projectionTree),
  getWorkspace: () => Effect.succeed(null),
  persistSnapshot: (input: PersistSessionSnapshotInput) =>
    Effect.sync(() => {
      persistedSnapshots.push(input)
      persistSnapshotMock(input)
    }),
  updateRuntime: () => Effect.void,
  renameBranch: () => Effect.void,
  archiveBranch: () => Effect.void,
  restoreBranch: () => Effect.void,
  updateTreeUiState: () => Effect.void,
  recordActiveRun: () => Effect.void,
  clearActiveRun: () => Effect.void,
  clearInterruptedRuns: () => Effect.void,
  listActiveRunsForRecovery: () => Effect.succeed([]),
  markActiveRunInterrupted: () => Effect.void,
})

const TestAgentKernelLayer = Layer.succeed(AgentKernelService, {
  createSession: () => Effect.fail(new Error('createSession is not used')),
  run: (input: AgentKernelRunInput) =>
    Effect.promise(async () => {
      runMock(input)
      return {
        newMessages: [
          {
            id: MessageId('assistant-1'),
            role: 'assistant',
            parts: [{ type: 'text', text: 'Done' }],
            model,
            createdAt: 3,
          },
        ],
        piSessionId: 'pi-session-1',
        piSessionFile: '/tmp/pi-session-1.jsonl',
        sessionSnapshot: {
          activeNodeId: 'assistant-1',
          nodes: [
            {
              id: 'assistant-1',
              parentId: null,
              piEntryType: 'message',
              kind: 'assistant_message',
              role: 'assistant',
              timestampMs: 3,
              contentJson: '{}',
              metadataJson: '{}',
              pathDepth: 0,
              createdOrder: 0,
            },
          ],
        },
      }
    }),
  getContextUsage: () => Effect.fail(new Error('getContextUsage is not used')),
  compact: () => Effect.fail(new Error('compact is not used')),
  navigateTree: () => Effect.fail(new Error('navigateTree is not used')),
  forkSession: () => Effect.fail(new Error('forkSession is not used')),
  getSessionSnapshot: () => Effect.fail(new Error('getSessionSnapshot is not used')),
})

const TestLayer = Layer.mergeAll(
  TestSessionProjectionLayer,
  Layer.succeed(ProviderService, {
    get: () => Effect.succeed(undefined),
    getAll: () => Effect.succeed([]),
    getProviderForModel: () => Effect.dieMessage('getProviderForModel is not used'),
    isKnownModel: () => Effect.succeed(true),
  }),
  Layer.succeed(SettingsService, {
    get: () => Effect.succeed(DEFAULT_SETTINGS),
    update: () => Effect.void,
    initialize: () => Effect.void,
    flushForTests: () => Effect.void,
  }),
  TestSessionLayer,
  TestAgentKernelLayer,
  EmptyExtensionRuntimeLayer,
)

function firstPersistedSnapshot() {
  const snapshot = persistedSnapshots[0]
  if (!snapshot) throw new Error('Expected a persisted session snapshot')
  return snapshot
}

function agentLoopNode(input: {
  readonly id: string
  readonly parentId: string | null
  readonly event: AgentTransportCustomEvent
  readonly createdOrder: number
}): SessionNode {
  return {
    id: SessionNodeId(input.id),
    sessionId,
    parentId: input.parentId ? SessionNodeId(input.parentId) : null,
    piEntryType: 'custom',
    kind: 'custom',
    timestampMs: input.event.timestamp,
    createdOrder: input.createdOrder,
    pathDepth: input.createdOrder,
    branchId,
    contentJson: JSON.stringify({
      customType: OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE,
      event: input.event,
    }),
    metadataJson: JSON.stringify({
      customType: OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE,
    }),
  }
}

describe('executeAgentRun agent-loop event durability', () => {
  beforeEach(() => {
    projectionTree = runServiceSessionTree
    persistedSnapshots.length = 0
    runMock.mockReset()
    persistSnapshotMock.mockReset()
  })

  it('persists agent-loop events without moving the active Pi head', async () => {
    runMock.mockImplementationOnce((input: AgentKernelRunInput) => {
      input.onEvent({
        type: 'custom',
        timestamp: 9,
        name: 'openwaggle.github.issues.summary',
        value: { open: 2 },
      })
      input.onEvent({
        type: 'agent_interaction_request',
        timestamp: 10,
        interaction: {
          interactionId: 'interaction-1',
          sessionId,
          runId: 'run-agent-loop-1',
          kind: 'confirm',
          source: 'pi-ui',
          createdAt: 10,
          title: 'Approve?',
          message: 'Allow the extension action?',
        },
      })
      input.onEvent({
        type: 'agent_interaction_resolved',
        timestamp: 11,
        runId: 'run-agent-loop-1',
        interactionId: 'interaction-1',
        kind: 'confirm',
        status: 'resolved',
        response: { kind: 'confirm', accepted: true },
      })
    })

    await Effect.runPromise(
      executeAgentRun({
        sessionId,
        runId: 'run-agent-loop-1',
        payload: { text: 'Run extension tool', thinkingLevel: 'medium', attachments: [] },
        model,
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }).pipe(Effect.provide(TestLayer)),
    )

    const persisted = firstPersistedSnapshot()

    expect(persisted.activeNodeId).toBe('assistant-1')
    expect(persisted.nodes.slice(-3)).toMatchObject([
      { id: 'run-agent-loop-1:agent-loop:0', parentId: 'assistant-1', timestampMs: 9 },
      { id: 'run-agent-loop-1:agent-loop:1', parentId: 'run-agent-loop-1:agent-loop:0' },
      { id: 'run-agent-loop-1:agent-loop:2', parentId: 'run-agent-loop-1:agent-loop:1' },
    ])
    expect(persisted.nodes.at(-1)?.contentJson).toContain('agent_interaction_resolved')
  })

  it('carries existing durable agent-loop nodes across replacement snapshots', async () => {
    projectionTree = {
      ...runServiceSessionTree,
      nodes: [
        agentLoopNode({
          id: 'run-previous:agent-loop:0',
          parentId: 'assistant-1',
          createdOrder: 1,
          event: {
            type: 'custom',
            timestamp: 8,
            name: 'openwaggle.previous.summary',
            value: { status: 'done' },
          },
        }),
      ],
    }

    await Effect.runPromise(
      executeAgentRun({
        sessionId,
        runId: 'run-without-agent-loop-events',
        payload: { text: 'Continue without extensions', thinkingLevel: 'medium', attachments: [] },
        model,
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }).pipe(Effect.provide(TestLayer)),
    )

    const persisted = firstPersistedSnapshot()

    expect(persisted.activeNodeId).toBe('assistant-1')
    expect(persisted.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'run-previous:agent-loop:0',
          contentJson: expect.stringContaining('openwaggle.previous.summary'),
        }),
      ]),
    )
  })
})
