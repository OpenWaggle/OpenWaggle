// @vitest-environment jsdom

import {
  MessageId,
  SessionBranchId,
  SessionId,
  SessionNodeId,
  SupportedModelId,
} from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail, SessionNode, SessionWorkspace } from '@shared/types/session'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/features/sessions/state'
import { type TranscriptSectionParams, useTranscriptSection } from '../useTranscriptSection'

const { getSessionWorkspace } = vi.hoisted(() => ({ getSessionWorkspace: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({
  api: { getSessionWorkspace },
}))

const SESSION_ID = SessionId('session-1')
const CONVERSATION_ID = SessionId('session-1')
const MAIN_BRANCH_ID = SessionBranchId('session-1:main')

function uiMessage(id: string, role: 'user' | 'assistant', content: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content }],
    createdAt: new Date(1),
  }
}

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
    hasMessage: true,
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

function workspaceWithPath(
  nodes: readonly SessionNode[],
  activeNodeId: SessionNodeId,
  updatedAt = 4,
) {
  return {
    tree: {
      session: {
        id: SESSION_ID,
        title: 'Branch test',
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt,
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

const phase = {
  current: null,
  completed: [],
  totalElapsedMs: 0,
  reset: vi.fn(),
}

function transcriptParams(
  overrides: Partial<TranscriptSectionParams> = {},
): TranscriptSectionParams {
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
    activeSessionId: CONVERSATION_ID,
    activeSession: null,
    model: SupportedModelId('openai/gpt-5'),
    waggleStatus: 'idle',
    phase,
    extensionRegistry: null,
    extensionProjectPaths: [],
    handleOpenProject: vi.fn(),
    handleSelectProjectPath: vi.fn(),
    handleSendText: vi.fn(),
    openSettings: vi.fn(),
    handleBranchFromMessage: vi.fn(),
    handleForkFromMessage: vi.fn(),
    handleForkFromResponse: vi.fn(),
    handleDismissInterruptedRun: vi.fn(),
    pendingSend: null,
    onPendingSendConsumed: vi.fn(),
    handleViewTurnDiff: vi.fn(),
    turnAnchorMessageIds: new Set<string>(),
    turnsByAnchorNodeId: new Map(),
    compactionStatus: null,
    ...overrides,
  }
}

function detail(updatedAt: number, nodes: readonly SessionNode[]): SessionDetail {
  return {
    id: SESSION_ID,
    title: 'Branch test',
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt,
    messages: nodes.flatMap((node) => (node.message ? [node.message] : [])),
  }
}

/*
 * A Session OpenWaggle created whose Pi file was deleted starts a new transcript with its next
 * message, and its saved transcript holds only that. The open view showed the old messages from
 * the workspace it had loaded, with the new ones after them, until a reload.
 */
describe('useTranscriptSection after a Run replaced the transcript', () => {
  beforeEach(() => {
    getSessionWorkspace.mockReset()
    useSessionStore.setState({ ...useSessionStore.getInitialState(), activeWorkspace: null })
  })

  it('shows only the new transcript once the Session holds nothing the workspace showed', async () => {
    const oldUser = sessionNode('old-user', null, 'user', 'First', 0)
    const oldAnswer = sessionNode('old-answer', 'old-user', 'assistant', 'First answer', 1)
    const newUser = sessionNode('new-user', null, 'user', 'Second', 2)
    const newAnswer = sessionNode('new-answer', 'new-user', 'assistant', 'Second answer', 3)
    useSessionStore.setState({
      activeWorkspace: workspaceWithPath([oldUser, oldAnswer], oldAnswer.id),
    })
    getSessionWorkspace.mockResolvedValue(
      workspaceWithPath([oldUser, oldAnswer, newUser, newAnswer], newAnswer.id, 10),
    )
    const { result, rerender } = renderHook(
      (params: TranscriptSectionParams) => useTranscriptSection(params),
      {
        initialProps: transcriptParams({
          activeSession: detail(4, [oldUser, oldAnswer]),
          messages: [
            uiMessage('old-user', 'user', 'First'),
            uiMessage('old-answer', 'assistant', 'First answer'),
          ],
        }),
      },
    )
    expect(result.current.messages.map((message) => message.id)).toEqual(['old-user', 'old-answer'])

    // The Run settled, and the Session's new detail holds only the new transcript.
    act(() => {
      rerender(
        transcriptParams({
          activeSession: detail(10, [newUser, newAnswer]),
          messages: [
            uiMessage('new-user', 'user', 'Second'),
            uiMessage('new-answer', 'assistant', 'Second answer'),
          ],
        }),
      )
    })

    await waitFor(() =>
      expect(result.current.messages.map((message) => message.id)).toEqual([
        'new-user',
        'new-answer',
      ]),
    )
    expect(getSessionWorkspace).toHaveBeenCalledWith(
      SESSION_ID,
      undefined,
      expect.objectContaining({ window: expect.any(Object) }),
    )
  })
})
