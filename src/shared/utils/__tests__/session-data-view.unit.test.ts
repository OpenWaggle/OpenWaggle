import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { MessageId, SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type {
  SessionContentTree,
  SessionContentWorkspace,
  SessionDetail,
  SessionNode,
} from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import {
  SESSION_TREE_PREVIEW_CHARACTERS,
  sessionDetailView,
  sessionTreeView,
  sessionWorkspaceView,
} from '../session-data-view'

const SESSION_ID = SessionId('session-1')
const BRANCH_ID = SessionBranchId('session-1:main')

function messageNode(
  id: string,
  parentId: string | null,
  text: string,
  order: number,
): SessionNode {
  return {
    id: SessionNodeId(id),
    sessionId: SESSION_ID,
    parentId: parentId ? SessionNodeId(parentId) : null,
    piEntryType: 'message',
    kind: order % 2 === 0 ? 'user_message' : 'assistant_message',
    role: order % 2 === 0 ? 'user' : 'assistant',
    timestampMs: order,
    createdOrder: order,
    pathDepth: order,
    branchId: BRANCH_ID,
    message: {
      id: MessageId(id),
      role: order % 2 === 0 ? 'user' : 'assistant',
      parts: [{ type: 'text', text }],
      createdAt: order,
    },
    contentJson: JSON.stringify({ parts: [{ type: 'text', text }] }),
    metadataJson: JSON.stringify({ usage: { input: 10 } }),
  }
}

function auditNode(id: string, parentId: string, order: number): SessionNode {
  return {
    id: SessionNodeId(id),
    sessionId: SESSION_ID,
    parentId: SessionNodeId(parentId),
    piEntryType: 'custom',
    kind: 'custom',
    timestampMs: order,
    createdOrder: order,
    pathDepth: order,
    contentJson: JSON.stringify({
      customType: OPENWAGGLE_AGENT_LOOP.SESSION_EVENT_CUSTOM_TYPE,
      event: { type: 'custom', name: 'notice' },
    }),
    metadataJson: '{}',
  }
}

function chain(count: number, text = 'text') {
  const nodes: SessionNode[] = []
  for (let index = 0; index < count; index += 1) {
    nodes.push(
      messageNode(`n${index}`, index === 0 ? null : `n${index - 1}`, `${text} ${index}`, index),
    )
  }
  return nodes
}

function tree(nodes: readonly SessionNode[]): SessionContentTree {
  return {
    session: { id: SESSION_ID, title: 'S', projectPath: null, createdAt: 1, updatedAt: 2 },
    nodes,
    branches: [],
    branchStates: [],
    uiState: null,
  }
}

function workspace(nodes: readonly SessionNode[], pathNodes = nodes): SessionContentWorkspace {
  const last = pathNodes.at(-1)
  return {
    tree: tree(nodes),
    activeBranchId: BRANCH_ID,
    activeNodeId: last?.id ?? null,
    transcriptPath: pathNodes.map((node) => ({
      node,
      branchId: node.branchId,
      isActive: node.id === last?.id,
    })),
  }
}

describe('sessionTreeView', () => {
  it('carries structure and a short preview, never node content (B5)', () => {
    const long = `   ${'word '.repeat(400)}`
    const [node] = sessionTreeView(tree([messageNode('a', null, long, 0)])).nodes

    expect(node).toEqual({
      id: SessionNodeId('a'),
      sessionId: SESSION_ID,
      parentId: null,
      piEntryType: 'message',
      kind: 'user_message',
      role: 'user',
      timestampMs: 0,
      createdOrder: 0,
      pathDepth: 0,
      branchId: BRANCH_ID,
      hasMessage: true,
      preview: long.trimStart().slice(0, SESSION_TREE_PREVIEW_CHARACTERS),
    })
  })

  it('never ends the preview in half of a character outside the BMP', () => {
    // An emoji is two UTF-16 units; this one starts at the last unit the preview can hold.
    const text = `${'a'.repeat(SESSION_TREE_PREVIEW_CHARACTERS - 1)}😀 and more`
    const [node] = sessionTreeView(tree([messageNode('a', null, text, 0)])).nodes

    expect(node?.preview).toBe(`${'a'.repeat(SESSION_TREE_PREVIEW_CHARACTERS - 1)}😀`)
    expect(node?.preview?.isWellFormed()).toBe(true)
  })

  it('keeps the content of agent-loop audit nodes, which the transcript places as cards', () => {
    const audit = auditNode('audit', 'a', 1)
    const nodes = sessionTreeView(tree([messageNode('a', null, 'hi', 0), audit])).nodes

    expect(nodes[1]?.contentJson).toBe(audit.contentJson)
    expect(nodes[0]).not.toHaveProperty('contentJson')
  })

  it('moves a small fraction of the content-bearing tree', () => {
    const nodes = chain(50, 'x'.repeat(10_000))
    const full = JSON.stringify(tree(nodes)).length
    const view = JSON.stringify(sessionTreeView(tree(nodes))).length

    expect(view / full).toBeLessThan(0.03)
  })
})

describe('sessionWorkspaceView', () => {
  it('returns the whole path, each message once, for a read without a request', () => {
    const nodes = chain(4)
    const view = sessionWorkspaceView(workspace(nodes), undefined, 7)

    expect(view.transcriptPath.map((entry) => String(entry.node.id))).toEqual([
      'n0',
      'n1',
      'n2',
      'n3',
    ])
    expect(view.transcriptWindow).toBeUndefined()
    expect(view.nodeMutationRevision).toBe(7)
    for (const entry of view.transcriptPath) {
      expect(entry.node.message).toBeDefined()
      expect(entry.node).not.toHaveProperty('metadataJson')
      expect(entry.node).not.toHaveProperty('contentJson')
    }
    expect(view.tree.nodes.every((node) => !('message' in node))).toBe(true)
  })

  it('returns the newest window of the path and where it starts', () => {
    const view = sessionWorkspaceView(workspace(chain(10)), { window: { minEntries: 3 } }, 1)

    expect(view.transcriptPath.map((entry) => String(entry.node.id))).toEqual(['n7', 'n8', 'n9'])
    expect(view.transcriptWindow).toEqual({ startIndex: 7, pathLength: 10 })
  })

  it('reaches back to a node the request names, such as a saved reading position', () => {
    const view = sessionWorkspaceView(
      workspace(chain(10)),
      { window: { minEntries: 2, includeNodeId: SessionNodeId('n4') } },
      1,
    )

    expect(view.transcriptWindow).toEqual({ startIndex: 4, pathLength: 10 })
    expect(view.transcriptPath).toHaveLength(6)
  })

  it('ignores a named node that is not on the selected path', () => {
    const view = sessionWorkspaceView(
      workspace(chain(10)),
      { window: { minEntries: 2, includeNodeId: SessionNodeId('elsewhere') } },
      1,
    )

    expect(view.transcriptWindow?.startIndex).toBe(8)
  })

  it('leaves out the content of held nodes while the revision is unchanged', () => {
    const request = {
      window: { minEntries: 3 },
      cached: { nodeMutationRevision: 4, nodeIds: [SessionNodeId('n7'), SessionNodeId('n8')] },
    }
    const view = sessionWorkspaceView(workspace(chain(10)), request, 4)

    expect(view.transcriptPath.map((entry) => entry.contentOmitted === true)).toEqual([
      true,
      true,
      false,
    ])
    expect(view.transcriptPath[0]?.node.message).toBeUndefined()
    expect(view.transcriptPath[2]?.node.message).toBeDefined()
  })

  it('sends every node again once an existing node changed (revision bumped)', () => {
    const request = {
      window: { minEntries: 3 },
      cached: { nodeMutationRevision: 4, nodeIds: [SessionNodeId('n7'), SessionNodeId('n8')] },
    }

    for (const revision of [5, null]) {
      const view = sessionWorkspaceView(workspace(chain(10)), request, revision)
      expect(view.transcriptPath.some((entry) => entry.contentOmitted)).toBe(false)
    }
  })
})

function detail(messageCount: number): SessionDetail {
  return {
    id: SESSION_ID,
    title: 'S',
    projectPath: null,
    messages: chain(messageCount).flatMap((node) => (node.message ? [node.message] : [])),
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('sessionDetailView', () => {
  it('returns only the messages after the caller’s while nodes were only appended', () => {
    const view = sessionDetailView(
      detail(5),
      { nodeMutationRevision: 3, messageCount: 3, lastMessageId: 'n2' },
      3,
    )

    expect(view?.messages.map((message) => String(message.id))).toEqual(['n3', 'n4'])
    expect(view?.messagesDelta).toEqual({ baseMessageCount: 3 })
    expect(view?.nodeMutationRevision).toBe(3)
  })

  it('returns every message when the caller’s last one is no longer where it was', () => {
    const view = sessionDetailView(
      detail(5),
      { nodeMutationRevision: 3, messageCount: 3, lastMessageId: 'other-branch' },
      3,
    )

    expect(view?.messages).toHaveLength(5)
    expect(view?.messagesDelta).toBeUndefined()
  })

  it('returns every message once an existing node changed', () => {
    const view = sessionDetailView(
      detail(5),
      { nodeMutationRevision: 3, messageCount: 3, lastMessageId: 'n2' },
      4,
    )

    expect(view?.messages).toHaveLength(5)
    expect(view?.messagesDelta).toBeUndefined()
    expect(view?.nodeMutationRevision).toBe(4)
  })

  it('returns the detail unchanged without a revision to label it with', () => {
    const full = detail(2)

    expect(
      sessionDetailView(
        full,
        { nodeMutationRevision: 0, messageCount: 0, lastMessageId: null },
        null,
      ),
    ).toBe(full)
  })

  it('treats a caller holding nothing as a delta from the start', () => {
    const view = sessionDetailView(
      detail(2),
      { nodeMutationRevision: 9, messageCount: 0, lastMessageId: null },
      9,
    )

    expect(view?.messages).toHaveLength(2)
    expect(view?.messagesDelta).toEqual({ baseMessageCount: 0 })
  })
})
