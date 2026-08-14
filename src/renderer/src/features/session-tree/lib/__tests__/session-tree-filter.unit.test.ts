import type { Message } from '@shared/types/agent'
import { MessageId, SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { filterSessionTreeNodes, searchSessionTreeNodes } from '../session-tree-filter'

function message(input: {
  readonly id: string
  readonly role: Message['role']
  readonly text: string
}): Message {
  return {
    id: MessageId(input.id),
    role: input.role,
    parts: [{ type: 'text', text: input.text }],
    createdAt: 1,
  }
}

function node(input: {
  readonly id: string
  readonly kind: SessionNode['kind']
  readonly role?: SessionNode['role']
  readonly parentId?: string | null
  readonly contentText?: string
}): SessionNode {
  return {
    id: SessionNodeId(input.id),
    sessionId: SessionId('session-1'),
    parentId: input.parentId ? SessionNodeId(input.parentId) : null,
    piEntryType: input.kind === 'label' ? 'label' : 'message',
    kind: input.kind,
    role: input.role,
    timestampMs: 1,
    createdOrder: 1,
    pathDepth: 0,
    message: input.role
      ? message({ id: input.id, role: input.role, text: input.contentText ?? input.id })
      : undefined,
    contentJson: JSON.stringify({ parts: [{ type: 'text', text: input.contentText ?? input.id }] }),
    metadataJson: '{}',
  }
}

describe('filterSessionTreeNodes', () => {
  const nodes = [
    node({ id: 'user-1', kind: 'user_message', role: 'user' }),
    node({ id: 'assistant-1', kind: 'assistant_message', role: 'assistant' }),
    node({ id: 'tool-1', kind: 'tool_result' }),
    node({ id: 'label-1', kind: 'label' }),
    node({ id: 'model-1', kind: 'model_change' }),
    node({ id: 'thinking-1', kind: 'thinking_level_change' }),
    node({ id: 'session-info-1', kind: 'session_info' }),
    node({ id: 'custom-1', kind: 'custom' }),
  ]

  it('mirrors Pi default filtering by hiding bookkeeping nodes', () => {
    expect(filterSessionTreeNodes(nodes, 'default').map((item) => String(item.id))).toEqual([
      'user-1',
      'assistant-1',
      'tool-1',
    ])
  })

  it('supports Pi filter modes', () => {
    expect(filterSessionTreeNodes(nodes, 'no-tools').map((item) => String(item.id))).toEqual([
      'user-1',
      'assistant-1',
    ])
    expect(filterSessionTreeNodes(nodes, 'user-only').map((item) => String(item.id))).toEqual([
      'user-1',
    ])
    expect(filterSessionTreeNodes(nodes, 'labeled-only').map((item) => String(item.id))).toEqual([
      'label-1',
    ])
    expect(filterSessionTreeNodes(nodes, 'all').map((item) => String(item.id))).toEqual([
      'user-1',
      'assistant-1',
      'tool-1',
      'label-1',
      'model-1',
      'thinking-1',
      'session-info-1',
      'custom-1',
    ])
  })
})

describe('searchSessionTreeNodes', () => {
  it('searches visible node text with normalized whitespace and casing', () => {
    const nodes = [
      node({ id: 'root', kind: 'user_message', role: 'user', contentText: 'Design tree nodes' }),
      node({
        id: 'answer',
        kind: 'assistant_message',
        role: 'assistant',
        parentId: 'root',
        contentText: 'Natural branch animation',
      }),
    ]

    expect(
      searchSessionTreeNodes({ nodes, filteredNodes: nodes, query: '  BRANCH   animation ' }).map(
        (item) => String(item.id),
      ),
    ).toEqual(['root', 'answer'])
  })

  it('preserves visible ancestors for matching descendants', () => {
    const nodes = [
      node({ id: 'root', kind: 'user_message', role: 'user', contentText: 'Start' }),
      node({
        id: 'hidden-tool',
        kind: 'tool_result',
        parentId: 'root',
        contentText: 'tool output',
      }),
      node({
        id: 'leaf',
        kind: 'assistant_message',
        role: 'assistant',
        parentId: 'hidden-tool',
        contentText: 'Needle result',
      }),
    ]

    expect(
      searchSessionTreeNodes({
        nodes,
        filteredNodes: [nodes[0], nodes[2]],
        query: 'needle',
      }).map((item) => String(item.id)),
    ).toEqual(['root', 'leaf'])
  })

  it('searches persisted content when a node has no hydrated message', () => {
    const nodes = [
      node({
        id: 'summary-node',
        kind: 'branch_summary',
        contentText: 'Persisted branch summary text',
      }),
    ]

    expect(
      searchSessionTreeNodes({ nodes, filteredNodes: nodes, query: 'branch summary text' }).map(
        (item) => String(item.id),
      ),
    ).toEqual(['summary-node'])
  })

  it('searches branch ids so visible branch badges can be found', () => {
    const nodes = [
      {
        ...node({ id: 'head', kind: 'assistant_message', role: 'assistant' }),
        branchId: SessionBranchId('feature-search-branch'),
      },
    ]

    expect(
      searchSessionTreeNodes({ nodes, filteredNodes: nodes, query: 'search-branch' }).map((item) =>
        String(item.id),
      ),
    ).toEqual(['head'])
  })

  it('returns the filtered nodes unchanged for blank searches', () => {
    const nodes = [node({ id: 'root', kind: 'user_message', role: 'user' })]

    expect(searchSessionTreeNodes({ nodes, filteredNodes: nodes, query: '   ' })).toBe(nodes)
  })
})
