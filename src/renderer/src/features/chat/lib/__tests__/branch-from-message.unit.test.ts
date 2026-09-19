import { MessageId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionNode, SessionNodeKind } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import {
  createBranchDraftSelection,
  createBranchDraftSelectionFromNode,
  shouldPromptForBranchSummary,
} from '../branch-from-message'
import { reconcileSnapshotUserMessages } from '../chat-message-reconciliation'

const SESSION_ID = SessionId('session-1')

function message(id: string, role: UIMessage['role'], text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content: text }],
  }
}

function node(
  id: string,
  parentId: string | null,
  overrides?: { readonly kind?: SessionNodeKind; readonly text?: string },
): SessionNode {
  const kind = overrides?.kind ?? 'user_message'
  return {
    id: SessionNodeId(id),
    sessionId: SESSION_ID,
    parentId: parentId ? SessionNodeId(parentId) : null,
    piEntryType: 'message',
    kind,
    role: kind === 'assistant_message' ? 'assistant' : 'user',
    timestampMs: 1,
    createdOrder: 1,
    pathDepth: 1,
    ...(overrides?.text
      ? {
          message: {
            id: MessageId(id),
            role: kind === 'assistant_message' ? 'assistant' : 'user',
            parts: [{ type: 'text', text: overrides.text }],
            createdAt: 1,
          },
        }
      : {}),
    contentJson: '{}',
    metadataJson: '{}',
  }
}

function workspace(entryNode: SessionNode, allNodes: readonly SessionNode[] = [entryNode]) {
  return {
    tree: {
      session: {
        id: SESSION_ID,
        title: 'Session',
        projectPath: '/tmp/project',
        archived: false,
        createdAt: 1,
        updatedAt: 1,
        lastActiveNodeId: entryNode.id,
        lastActiveBranchId: null,
      },
      nodes: allNodes,
      branches: [],
      branchStates: [],
      uiState: null,
    },
    activeBranchId: null,
    activeNodeId: entryNode.id,
    transcriptPath: [{ node: entryNode, isActive: true }],
  }
}

describe('createBranchDraftSelection', () => {
  it('does not invent a source node before the transcript workspace is hydrated', () => {
    expect(
      createBranchDraftSelection({
        messages: [message('branch-point', 'user', 'Branch from this user node')],
        workspace: null,
        messageId: 'branch-point',
      }),
    ).toBeNull()
  })

  it('branches from a user message parent and prefills the composer with the original text', () => {
    const result = createBranchDraftSelection({
      messages: [message('user-1', 'user', 'Fix this bug')],
      workspace: workspace(node('user-1', 'assistant-parent')),
      messageId: 'user-1',
    })

    expect(result).toEqual({
      sourceNodeId: SessionNodeId('assistant-parent'),
      routeNodeId: SessionNodeId('assistant-parent'),
      prefillText: 'Fix this bug',
    })
  })

  it('branches directly from assistant messages without composer prefill', () => {
    const result = createBranchDraftSelection({
      messages: [message('assistant-1', 'assistant', 'Here is the answer')],
      workspace: workspace(node('assistant-1', 'user-parent', { kind: 'assistant_message' })),
      messageId: 'assistant-1',
    })

    expect(result).toEqual({
      sourceNodeId: SessionNodeId('assistant-1'),
      routeNodeId: SessionNodeId('assistant-1'),
    })
  })

  it('preserves real root-user no-parent semantics', () => {
    expect(
      createBranchDraftSelection({
        messages: [message('root', 'user', 'First prompt')],
        workspace: workspace(node('root', null)),
        messageId: 'root',
      }),
    ).toEqual({ sourceNodeId: SessionNodeId('root'), routeNodeId: SessionNodeId('root') })
  })

  it('uses a canonical hidden parent rather than the preceding visible message', () => {
    const userNode = node('user-2', 'hidden-compaction')
    expect(
      createBranchDraftSelection({
        messages: [
          message('assistant-1', 'assistant', 'Previous visible reply'),
          message('user-2', 'user', 'Retry'),
        ],
        workspace: workspace(userNode),
        messageId: 'user-2',
      }),
    ).toEqual({
      sourceNodeId: SessionNodeId('hidden-compaction'),
      routeNodeId: SessionNodeId('hidden-compaction'),
      prefillText: 'Retry',
    })
  })

  it('resolves known canonical nodes outside the selected transcript path', () => {
    const selected = node('other-leaf', null)
    expect(
      createBranchDraftSelection({
        messages: [message('user-2', 'user', 'Retry')],
        workspace: workspace(selected, [selected, node('user-2', 'canonical-parent')]),
        messageId: 'user-2',
      }),
    ).toEqual({
      sourceNodeId: SessionNodeId('canonical-parent'),
      routeNodeId: SessionNodeId('canonical-parent'),
      prefillText: 'Retry',
    })
  })

  it.each([0, 3])(
    'resolves an optimistic row by its reconciled canonical created order %i',
    (createdOrder) => {
      const persistedNode = { ...node('canonical-user', 'canonical-parent'), createdOrder }
      const messages = reconcileSnapshotUserMessages(
        [
          {
            ...message('canonical-user', 'user', 'Retry'),
            metadata: { sessionNodeCreatedOrder: persistedNode.createdOrder },
          },
        ],
        [message('optimistic-user', 'user', 'Retry')],
      )
      expect(messages[0]?.id).toBe('optimistic-user')
      expect(
        createBranchDraftSelection({
          messages,
          workspace: workspace(persistedNode),
          messageId: 'optimistic-user',
        }),
      ).toEqual({
        sourceNodeId: SessionNodeId('canonical-parent'),
        routeNodeId: SessionNodeId('canonical-parent'),
        prefillText: 'Retry',
      })
    },
  )

  it('keeps exact node identity authoritative over conflicting created-order metadata', () => {
    const clicked = node('exact-id', 'exact-parent')
    const other = { ...node('other-id', 'other-parent'), createdOrder: 9 }
    expect(
      createBranchDraftSelection({
        messages: [
          { ...message('exact-id', 'user', 'Retry'), metadata: { sessionNodeCreatedOrder: 9 } },
        ],
        workspace: workspace(clicked, [clicked, other]),
        messageId: 'exact-id',
      })?.sourceNodeId,
    ).toBe('exact-parent')
  })

  it('rejects created-order matches with a different canonical kind or Session', () => {
    const wrongRole = node('assistant', null, { kind: 'assistant_message' })
    const wrongSession = {
      ...node('foreign-user', 'foreign-parent'),
      sessionId: SessionId('other-session'),
    }
    expect(
      createBranchDraftSelection({
        messages: [
          { ...message('optimistic', 'user', 'Retry'), metadata: { sessionNodeCreatedOrder: 1 } },
        ],
        workspace: workspace(wrongRole, [wrongRole, wrongSession]),
        messageId: 'optimistic',
      }),
    ).toBeNull()
  })
})

describe('createBranchDraftSelectionFromNode', () => {
  it('mirrors Pi retry semantics for Session Tree user-message nodes', () => {
    const result = createBranchDraftSelectionFromNode(
      node('user-2', 'assistant-parent', { kind: 'user_message', text: 'Retry with tests' }),
    )

    expect(result).toEqual({
      sourceNodeId: SessionNodeId('assistant-parent'),
      routeNodeId: SessionNodeId('assistant-parent'),
      prefillText: 'Retry with tests',
    })
  })
})

describe('shouldPromptForBranchSummary', () => {
  it('does not prompt when selecting the current active leaf', () => {
    const active = node('assistant-1', 'user-1', { kind: 'assistant_message' })

    expect(shouldPromptForBranchSummary(workspace(active), active.id)).toBe(false)
  })

  it('prompts when the current branch has content downstream from the selected node', () => {
    const root = node('user-1', null, { kind: 'user_message' })
    const assistant = node('assistant-1', 'user-1', { kind: 'assistant_message' })
    const followUp = node('user-2', 'assistant-1', { kind: 'user_message' })
    const activeWorkspace = workspace(followUp, [root, assistant, followUp])

    expect(shouldPromptForBranchSummary(activeWorkspace, root.id)).toBe(true)
  })

  it('skips the prompt when only bookkeeping nodes would be abandoned', () => {
    const root = node('assistant-1', null, { kind: 'assistant_message' })
    const label = node('label-1', 'assistant-1', { kind: 'label' })
    const activeWorkspace = workspace(label, [root, label])

    expect(shouldPromptForBranchSummary(activeWorkspace, root.id)).toBe(false)
  })
})
