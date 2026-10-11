import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { hydrateSessionMessage } from '../../../../store/session-details/message-hydration'
import { projectPiSessionSnapshot } from '../session-projection'

const timestamp = '2026-10-09T10:00:00.000Z'
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function assistant(
  id: string,
  parentId: string,
  message: Partial<Pick<AssistantMessage, 'content' | 'stopReason' | 'errorMessage'>> = {},
): SessionEntry {
  return fromPartial<SessionEntry>({
    type: 'message',
    id,
    parentId,
    timestamp,
    message: {
      role: 'assistant',
      content: [],
      api: 'openai-responses',
      provider: 'p',
      model: 'm',
      usage,
      stopReason: 'stop',
      timestamp: 1,
      ...message,
    },
  })
}

const turn: SessionEntry = {
  type: 'custom_message',
  id: 'turn-1',
  parentId: null,
  timestamp,
  customType: 'pi-waggle.turn',
  content: 'Turn 1',
  display: false,
  details: {
    runId: 'run-1',
    turnNumber: 1,
    agentIndex: 1,
    agentLabel: 'Reviewer',
    agentModel: 'p/m',
    agentColor: 'amber',
  },
}

function hydrated(entries: readonly SessionEntry[], leafId: string) {
  const snapshot = projectPiSessionSnapshot({
    sessionManager: { getEntries: () => [...entries], getLeafId: () => leafId },
  })
  return new Map(
    snapshot.nodes
      .filter((node) => node.role === 'assistant')
      .map((node) => [
        node.id,
        hydrateSessionMessage({
          id: node.id,
          session_id: 'session',
          parent_id: node.parentId,
          pi_entry_type: node.piEntryType,
          kind: node.kind,
          role: node.role,
          timestamp_ms: node.timestampMs,
          content_json: node.contentJson,
          metadata_json: node.metadataJson,
          branch_hint_id: null,
          path_depth: node.pathDepth,
          created_order: node.createdOrder,
        }).metadata,
      ]),
  )
}

describe('the projection of a Waggle turn', () => {
  it('keeps a retried answer in its turn and shows no error for the attempt Pi dropped', () => {
    const metadata = hydrated(
      [
        turn,
        assistant('failed', 'turn-1', {
          stopReason: 'error',
          errorMessage: '503 Service Unavailable',
        }),
        {
          type: 'context_edit',
          id: 'edit',
          parentId: 'failed',
          timestamp,
          targetId: 'failed',
          replacement: null,
        },
        assistant('answer', 'edit', { content: [{ type: 'text', text: 'Retried answer' }] }),
      ],
      'answer',
    )

    expect(metadata.get('failed')?.error).toBeUndefined()
    expect(metadata.get('answer')?.waggle).toMatchObject({ agentLabel: 'Reviewer', turnNumber: 1 })
  })

  it('keeps the answer after a tool call in its turn', () => {
    const metadata = hydrated(
      [
        turn,
        assistant('tool-call', 'turn-1', {
          content: [{ type: 'toolCall', id: 'call-1', name: 'ping', arguments: {} }],
          stopReason: 'toolUse',
        }),
        {
          type: 'message',
          id: 'tool-result',
          parentId: 'tool-call',
          timestamp,
          message: {
            role: 'toolResult',
            toolCallId: 'call-1',
            toolName: 'ping',
            content: [{ type: 'text', text: 'pong' }],
            isError: false,
            timestamp: 1,
          },
        },
        assistant('answer', 'tool-result', { content: [{ type: 'text', text: 'After the tool' }] }),
      ],
      'answer',
    )

    expect(metadata.get('answer')?.waggle).toMatchObject({ agentLabel: 'Reviewer' })
  })

  it("keeps the error of a failed turn's last response", () => {
    const metadata = hydrated(
      [
        turn,
        assistant('failed', 'turn-1', { stopReason: 'error', errorMessage: '401 Unauthorized' }),
      ],
      'failed',
    )

    expect(metadata.get('failed')).toMatchObject({
      error: '401 Unauthorized',
      waggle: { agentLabel: 'Reviewer' },
    })
  })
})
