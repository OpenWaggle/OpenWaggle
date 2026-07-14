// @vitest-environment jsdom

import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import {
  MessageId,
  SessionBranchId,
  SessionId,
  SessionNodeId,
  SupportedModelId,
} from '@shared/types/brand'
import type { SessionNode, SessionWorkspace } from '@shared/types/session'
import type {
  AgentTransportCustomEvent,
  AgentTransportInteractionRequestEvent,
  AgentTransportInteractionResolvedEvent,
} from '@shared/types/stream'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/features/sessions/state'
import type { ChatRow } from '../../lib/types-chat-row'
import { type TranscriptSectionParams, useTranscriptSection } from '../useTranscriptSection'

vi.mock('@/shared/lib/ipc', () => ({
  api: {},
}))

const SESSION_ID = SessionId('session-1')
const MAIN_BRANCH_ID = SessionBranchId('session-1:main')

type PersistedAgentLoopEvent =
  | AgentTransportCustomEvent
  | AgentTransportInteractionRequestEvent
  | AgentTransportInteractionResolvedEvent

function sessionNode(
  id: string,
  parentId: string | null,
  role: 'user' | 'assistant',
  content: string,
  createdOrder: number,
): SessionNode {
  return {
    id: SessionNodeId(id),
    sessionId: SESSION_ID,
    parentId: parentId ? SessionNodeId(parentId) : null,
    piEntryType: 'message',
    kind: role === 'user' ? 'user_message' : 'assistant_message',
    role,
    timestampMs: createdOrder + 1,
    createdOrder,
    pathDepth: createdOrder,
    branchId: MAIN_BRANCH_ID,
    message: {
      id: MessageId(id),
      role,
      parts: [{ type: 'text', text: content }],
      createdAt: createdOrder + 1,
    },
    contentJson: JSON.stringify({ parts: [{ type: 'text', text: content }], model: null }),
    metadataJson: '{}',
  }
}

function agentLoopEventNode(
  id: string,
  parentId: string | null,
  event: PersistedAgentLoopEvent,
  createdOrder: number,
): SessionNode {
  return {
    id: SessionNodeId(id),
    sessionId: SESSION_ID,
    parentId: parentId ? SessionNodeId(parentId) : null,
    piEntryType: 'custom',
    kind: 'custom',
    timestampMs: event.timestamp,
    createdOrder,
    pathDepth: createdOrder,
    branchId: MAIN_BRANCH_ID,
    contentJson: JSON.stringify({
      customType: OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE,
      event,
    }),
    metadataJson: JSON.stringify({
      customType: OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE,
    }),
  }
}

function transcriptPathForActiveNode(
  nodes: readonly SessionNode[],
  activeNodeId: SessionNodeId,
): SessionWorkspace['transcriptPath'] {
  const nodesById = new Map(nodes.map((node) => [String(node.id), node]))
  const path: SessionNode[] = []
  const seen = new Set<string>()
  let current = nodesById.get(String(activeNodeId)) ?? null

  while (current && !seen.has(String(current.id))) {
    path.unshift(current)
    seen.add(String(current.id))
    current = current.parentId ? (nodesById.get(String(current.parentId)) ?? null) : null
  }

  return path.map((node) => ({
    node,
    branchId: node.branchId,
    isActive: node.id === activeNodeId,
  }))
}

function workspaceWithPath(nodes: readonly SessionNode[], activeNodeId: SessionNodeId) {
  return {
    tree: {
      session: {
        id: SESSION_ID,
        title: 'Agent loop test',
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt: 4,
        lastActiveNodeId: activeNodeId,
        lastActiveBranchId: MAIN_BRANCH_ID,
      },
      nodes,
      branches: [
        {
          id: MAIN_BRANCH_ID,
          sessionId: SESSION_ID,
          sourceNodeId: null,
          headNodeId: activeNodeId,
          name: 'main',
          isMain: true,
          createdAt: 1,
          updatedAt: 4,
        },
      ],
      branchStates: [],
      uiState: null,
    },
    activeBranchId: MAIN_BRANCH_ID,
    activeNodeId,
    transcriptPath: transcriptPathForActiveNode(nodes, activeNodeId),
  }
}

function transcriptParams(): TranscriptSectionParams {
  return {
    messages: [],
    customMessages: [],
    interactionEvents: [],
    isLoading: false,
    isSteering: false,
    error: undefined,
    streamSignalVersion: 0,
    projectPath: '/tmp/project',
    recentProjects: [],
    activeSessionId: SESSION_ID,
    activeSession: null,
    model: SupportedModelId('openai/gpt-5'),
    waggleStatus: 'idle',
    phase: { current: null, completed: [], totalElapsedMs: 0, reset: vi.fn() },
    extensionRegistry: null,
    extensionProjectPaths: [],
    handleOpenProject: vi.fn(),
    handleSelectProjectPath: vi.fn(),
    handleSendText: vi.fn(),
    openSettings: vi.fn(),
    handleDismissInterruptedRun: vi.fn(),
    handleBranchFromMessage: vi.fn(),
    handleForkFromMessage: vi.fn(),
    userDidSend: false,
    onUserDidSendConsumed: vi.fn(),
  }
}

function agentLoopCustomRows(rows: readonly ChatRow[]) {
  return rows.filter((row) => row.type === 'agent-loop-custom-message')
}

function agentLoopInteractionRows(rows: readonly ChatRow[]) {
  return rows.filter((row) => row.type === 'agent-loop-interaction-event')
}

describe('useTranscriptSection agent-loop hydration', () => {
  beforeEach(() => {
    useSessionStore.setState({
      ...useSessionStore.getInitialState(),
      activeWorkspace: null,
    })
  })

  it('hydrates persisted agent-loop custom and interaction events into chat rows', () => {
    const previousAssistant = sessionNode('assistant-previous', null, 'assistant', 'Done', 0)
    const persistedCustom = agentLoopEventNode(
      'run-1:agent-loop:0',
      'assistant-previous',
      {
        type: 'custom',
        timestamp: 20,
        name: 'openwaggle.github.issues.summary',
        value: { open: 2 },
      },
      1,
    )
    const persistedRequest = agentLoopEventNode(
      'run-1:agent-loop:1',
      'run-1:agent-loop:0',
      {
        type: 'agent_interaction_request',
        timestamp: 30,
        interaction: {
          interactionId: 'interaction-1',
          sessionId: SESSION_ID,
          runId: 'run-1',
          kind: 'select',
          source: 'pi-ui',
          createdAt: 30,
          title: 'Pick issue',
          choices: ['#113', '#114'],
        },
      },
      2,
    )
    const persistedResolved = agentLoopEventNode(
      'run-1:agent-loop:2',
      'run-1:agent-loop:1',
      {
        type: 'agent_interaction_resolved',
        timestamp: 40,
        runId: 'run-1',
        interactionId: 'interaction-1',
        kind: 'select',
        status: 'resolved',
        response: { kind: 'select', selected: '#113' },
      },
      3,
    )
    const nextUser = sessionNode('user-next', 'assistant-previous', 'user', 'Continue', 4)
    const nextAssistant = sessionNode('assistant-next', 'user-next', 'assistant', 'Continued', 5)

    useSessionStore.setState({
      activeWorkspace: workspaceWithPath(
        [
          previousAssistant,
          persistedCustom,
          persistedRequest,
          persistedResolved,
          nextUser,
          nextAssistant,
        ],
        nextAssistant.id,
      ),
    })

    const { result } = renderHook(() => useTranscriptSection(transcriptParams()))

    expect(agentLoopCustomRows(result.current.chatRows)).toHaveLength(1)
    expect(agentLoopCustomRows(result.current.chatRows)[0]?.event).toEqual({
      type: 'custom',
      timestamp: 20,
      name: 'openwaggle.github.issues.summary',
      value: { open: 2 },
    })
    expect(agentLoopInteractionRows(result.current.chatRows).map((row) => row.event.type)).toEqual([
      'agent_interaction_request',
      'agent_interaction_resolved',
    ])
  })
})
