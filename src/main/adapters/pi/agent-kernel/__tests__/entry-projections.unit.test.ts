import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { projectionForPiEntry } from '../entry-projections'
import { projectPiSessionSnapshot } from '../session-projection'

const TIMESTAMP = '2026-05-19T10:00:00.000Z'

function base(id: string, parentId: string | null = null) {
  return { id, parentId, timestamp: TIMESTAMP }
}

describe('Pi entry projection', () => {
  it('projects model, thinking, compaction, branch summary, custom, label, and session metadata entries', () => {
    expect(
      projectionForPiEntry({
        ...base('model'),
        type: 'model_change',
        provider: 'openai',
        modelId: 'gpt-5.5',
      }),
    ).toMatchObject({ kind: 'model_change', role: null })
    expect(
      projectionForPiEntry({
        ...base('thinking'),
        type: 'thinking_level_change',
        thinkingLevel: 'xhigh',
      }),
    ).toMatchObject({ kind: 'thinking_level_change', role: null })
    expect(
      projectionForPiEntry({
        ...base('compaction'),
        type: 'compaction',
        summary: 'summary',
        firstKeptEntryId: 'kept',
        tokensBefore: 12,
        details: { source: 'test' },
        fromHook: true,
      }),
    ).toMatchObject({ kind: 'compaction_summary', role: null })
    expect(
      projectionForPiEntry({
        ...base('branch'),
        type: 'branch_summary',
        fromId: 'root',
        summary: 'branch summary',
      }),
    ).toMatchObject({ kind: 'branch_summary', role: null })
    expect(
      projectionForPiEntry({
        ...base('custom'),
        type: 'custom',
        customType: 'openwaggle',
        data: { ok: true },
      }),
    ).toMatchObject({ kind: 'custom', role: null })
    expect(
      projectionForPiEntry({
        ...base('label'),
        type: 'label',
        targetId: 'root',
        label: 'bookmark',
      }),
    ).toMatchObject({ kind: 'label', role: null })
    expect(
      projectionForPiEntry({ ...base('info'), type: 'session_info', name: 'Demo' }),
    ).toMatchObject({
      kind: 'session_info',
      role: null,
    })
  })

  it('projects visible Waggle custom messages as user messages', () => {
    const projection = projectionForPiEntry({
      ...base('visible'),
      type: 'custom_message',
      customType: 'openwaggle.waggle.user_request',
      content: 'Coordinate these agents.',
      details: { turn: 1 },
      display: true,
    })

    expect(projection.kind).toBe('user_message')
    expect(projection.role).toBe('user')
    expect(JSON.parse(projection.contentJson)).toMatchObject({
      parts: [{ type: 'text', text: 'Coordinate these agents.' }],
    })
  })

  it('projects session snapshots with deterministic depth and ordering', () => {
    const entries = [
      { ...base('root'), type: 'session_info', name: 'Root' },
      { ...base('child', 'root'), type: 'model_change', provider: 'openai', modelId: 'gpt-5.5' },
      { ...base('grandchild', 'child'), type: 'thinking_level_change', thinkingLevel: 'high' },
    ] satisfies SessionEntry[]

    const snapshot = projectPiSessionSnapshot({
      sessionManager: {
        getEntries: () => entries,
        getLeafId: () => 'grandchild',
      },
    })

    expect(snapshot.activeNodeId).toBe('grandchild')
    expect(snapshot.nodes.map((node) => [node.id, node.pathDepth, node.createdOrder])).toEqual([
      ['root', 0, 0],
      ['child', 1, 1],
      ['grandchild', 2, 2],
    ])
  })
})
