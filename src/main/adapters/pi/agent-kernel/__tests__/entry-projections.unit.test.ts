import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { projectionForPiEntry } from '../entry-projections'
import { projectPiSessionSnapshot } from '../session-projection'

const TIMESTAMP = '2026-05-19T10:00:00.000Z'

function base(id: string, parentId: string | null = null) {
  return { id, parentId, timestamp: TIMESTAMP }
}

function userMessage(id: string, parentId: string, text: string) {
  return {
    ...base(id, parentId),
    type: 'message',
    message: { role: 'user', content: text, timestamp: 1 },
  } satisfies SessionEntry
}

function assistantMessage(id: string, parentId: string, text: string) {
  return {
    ...base(id, parentId),
    type: 'message',
    message: {
      role: 'assistant',
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      content: [{ type: 'text', text }],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: 1,
    },
  } satisfies SessionEntry
}

function waggleTurn(id: string, parentId: string | null = null) {
  return {
    ...base(id, parentId),
    type: 'custom_message',
    customType: 'pi-waggle.turn',
    content: 'hidden coordination prompt',
    display: true,
    details: {
      runId: 'waggle-run-1',
      turnNumber: 1,
      agentIndex: 1,
      agentLabel: 'Reviewer',
      agentModel: 'anthropic/claude-sonnet-4',
      agentColor: 'amber',
    },
  } satisfies SessionEntry
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
      customType: 'pi-waggle.user-request',
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

  it('annotates assistant messages from preceding pi-waggle turn entries', () => {
    const entries = [
      waggleTurn('turn'),
      assistantMessage('assistant', 'turn', 'Reviewed.'),
    ] satisfies SessionEntry[]

    const snapshot = projectPiSessionSnapshot({
      sessionManager: {
        getEntries: () => entries,
        getLeafId: () => 'assistant',
      },
    })

    expect(JSON.parse(snapshot.nodes[1]?.metadataJson ?? '{}')).toMatchObject({
      waggle: {
        agentIndex: 1,
        agentLabel: 'Reviewer',
        agentColor: 'amber',
        agentModel: 'anthropic/claude-sonnet-4',
        turnNumber: 1,
        sessionId: 'waggle-run-1',
      },
    })
  })

  it('annotates assistant messages from direct user prompts under pi-waggle turn entries', () => {
    const entries = [
      waggleTurn('turn'),
      userMessage('prompt', 'turn', 'Continue Waggle as Reviewer.'),
      assistantMessage('assistant', 'prompt', 'Reviewed.'),
    ] satisfies SessionEntry[]

    const snapshot = projectPiSessionSnapshot({
      sessionManager: {
        getEntries: () => entries,
        getLeafId: () => 'assistant',
      },
    })

    expect(JSON.parse(snapshot.nodes[2]?.metadataJson ?? '{}')).toMatchObject({
      waggle: {
        agentIndex: 1,
        agentLabel: 'Reviewer',
        agentColor: 'amber',
        agentModel: 'anthropic/claude-sonnet-4',
        turnNumber: 1,
        sessionId: 'waggle-run-1',
      },
    })
  })

  it('does not annotate later normal assistant messages with stale Waggle metadata', () => {
    const entries = [
      waggleTurn('turn'),
      assistantMessage('waggle-assistant', 'turn', 'Reviewed.'),
      userMessage('normal-user', 'waggle-assistant', 'Now answer normally.'),
      assistantMessage('normal-assistant', 'normal-user', 'Normal answer.'),
    ] satisfies SessionEntry[]

    const snapshot = projectPiSessionSnapshot({
      sessionManager: {
        getEntries: () => entries,
        getLeafId: () => 'normal-assistant',
      },
    })

    expect(JSON.parse(snapshot.nodes[1]?.metadataJson ?? '{}')).toMatchObject({
      waggle: {
        agentLabel: 'Reviewer',
        sessionId: 'waggle-run-1',
      },
    })
    expect(JSON.parse(snapshot.nodes[3]?.metadataJson ?? '{}')).not.toHaveProperty('waggle')
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
