import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { projectPiSessionSnapshot } from '../session-projection'

const TOOL_CALL_PAIRS = 20_000
const GENEROUS_BOUND_MS = 5_000
const timestamp = '2026-10-09T10:00:00.000Z'

/** One Waggle turn of `pairs` tool calls, each answered by its tool result, then an answer. */
function longWaggleTurn(pairs: number) {
  const entries: SessionEntry[] = [
    fromPartial<SessionEntry>({
      type: 'custom_message',
      id: 'turn',
      parentId: null,
      timestamp,
      customType: 'pi-waggle.turn',
      content: 'Turn 1',
      display: false,
      details: {
        runId: 'run-1',
        turnNumber: 0,
        agentIndex: 0,
        agentLabel: 'Architect',
        agentModel: 'p/m',
        agentColor: 'blue',
      },
    }),
  ]
  let parentId = 'turn'
  for (let pair = 0; pair < pairs; pair += 1) {
    entries.push(
      fromPartial<SessionEntry>({
        type: 'message',
        id: `call-${String(pair)}`,
        parentId,
        timestamp,
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: `tool-${String(pair)}`, name: 'ls', arguments: {} }],
          stopReason: 'toolUse',
        },
      }),
      fromPartial<SessionEntry>({
        type: 'message',
        id: `result-${String(pair)}`,
        parentId: `call-${String(pair)}`,
        timestamp,
        message: {
          role: 'toolResult',
          toolCallId: `tool-${String(pair)}`,
          toolName: 'ls',
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
        },
      }),
    )
    parentId = `result-${String(pair)}`
  }
  entries.push(
    fromPartial<SessionEntry>({
      type: 'message',
      id: 'answer',
      parentId,
      timestamp,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Done' }], stopReason: 'stop' },
    }),
  )
  return entries
}

describe('projecting a long Waggle turn', () => {
  it('finds each response’s turn in time linear in the turn’s length', () => {
    const entries = longWaggleTurn(TOOL_CALL_PAIRS)
    const startedAt = performance.now()

    const snapshot = projectPiSessionSnapshot({
      sessionManager: { getEntries: () => entries, getLeafId: () => 'answer' },
    })

    expect(performance.now() - startedAt).toBeLessThan(GENEROUS_BOUND_MS)
    const answer = snapshot.nodes.find((node) => node.id === 'answer')
    expect(JSON.parse(answer?.metadataJson ?? '{}')).toMatchObject({
      waggle: { agentLabel: 'Architect', turnNumber: 0 },
    })
  })
})
