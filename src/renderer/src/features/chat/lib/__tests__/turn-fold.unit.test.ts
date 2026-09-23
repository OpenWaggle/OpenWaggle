import type { UIMessage } from '@shared/types/chat-ui'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { applyTurnFolds } from '../turn-fold'
import type { ChatRow, MessageChatRow } from '../types-chat-row'

function userMessage(id: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', content: 'Add rate limiting' }] }
}

function assistantMessage(id: string, parts: UIMessage['parts']): UIMessage {
  return { id, role: 'assistant', parts }
}

function messageRow(message: UIMessage): MessageChatRow {
  return {
    type: 'message',
    message,
    isStreaming: false,
    isRunActive: false,
    showTurnDivider: false,
    turnDividerProps: undefined,
  }
}

function toolCallPart(id: string): UIMessage['parts'][number] {
  return { type: 'tool-call', id, name: 'edit', arguments: '{}', state: 'done' }
}

function textPart(content: string): UIMessage['parts'][number] {
  return { type: 'text', content }
}

function settledInput(
  overrides: Partial<Parameters<typeof applyTurnFolds>[1]> = {},
): Parameters<typeof applyTurnFolds>[1] {
  return {
    isLoading: false,
    settledRunDurationMs: 12_000,
    turnDurationsByAnchorMessageId: new Map(),
    interrupted: false,
    expandedTurnKeys: new Set<string>(),
    ...overrides,
  }
}

describe('applyTurnFolds', () => {
  it('folds a settled turn with work behind a fold row, keeping only the terminal message', () => {
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      messageRow(assistantMessage('a1', [toolCallPart('t1')])),
      messageRow(assistantMessage('a2', [textPart('Done — added a limiter.')])),
    ]

    const result = applyTurnFolds(rows, settledInput())

    expect(result).toHaveLength(3)
    expect(result[0]).toBe(rows[0])
    expect(result[1]).toMatchObject({
      type: 'turn-fold',
      label: 'Worked for 12s',
      durationMs: 12_000,
    })
    const terminal = result[2]
    expect(terminal).toMatchObject({ type: 'message', turnPresentation: 'folded' })
  })

  it('leaves the transcript untouched while a run is active', () => {
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      messageRow(assistantMessage('a1', [toolCallPart('t1')])),
    ]

    const result = applyTurnFolds(rows, settledInput({ isLoading: true }))

    expect(result).toEqual(rows)
  })

  it('never folds a purely conversational turn', () => {
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      messageRow(assistantMessage('a1', [textPart('Sure — here is the plan.')])),
    ]

    const result = applyTurnFolds(rows, settledInput())

    expect(result).toEqual(rows)
  })

  it('keeps the fold row but reveals the full turn when expanded', () => {
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      messageRow(assistantMessage('a1', [toolCallPart('t1')])),
      messageRow(assistantMessage('a2', [textPart('Done.')])),
    ]

    const result = applyTurnFolds(rows, settledInput({ expandedTurnKeys: new Set(['u1']) }))

    expect(result).toHaveLength(4)
    expect(result[1]).toMatchObject({ type: 'turn-fold' })
    expect(result[2]).toBe(rows[1])
    expect(result[3]).toBe(rows[2])
  })

  it('labels an interrupted turn as You stopped', () => {
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      messageRow(assistantMessage('a1', [toolCallPart('t1')])),
      messageRow(assistantMessage('a2', [textPart('Partial work.')])),
    ]

    const result = applyTurnFolds(rows, settledInput({ interrupted: true }))

    expect(result[1]).toMatchObject({
      type: 'turn-fold',
      label: 'You stopped after 12s',
      interrupted: true,
    })
  })

  it('prefers the durable checkpoint duration over the live timer for earlier turns', () => {
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      messageRow(assistantMessage('a1', [toolCallPart('t1')])),
      messageRow(assistantMessage('a2', [textPart('First done.')])),
      messageRow(userMessage('u2')),
      messageRow(assistantMessage('a3', [toolCallPart('t2')])),
      messageRow(assistantMessage('a4', [textPart('Second done.')])),
    ]

    const result = applyTurnFolds(
      rows,
      settledInput({
        turnDurationsByAnchorMessageId: new Map([
          ['a2', 5_000],
          ['a4', 30_000],
        ]),
      }),
    )

    expect(result[1]).toMatchObject({ type: 'turn-fold', label: 'Worked for 5s' })
    expect(result[4]).toMatchObject({ type: 'turn-fold', label: 'Worked for 30s' })
  })

  it('falls back to Worked when no duration is known for an earlier turn', () => {
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      messageRow(assistantMessage('a1', [toolCallPart('t1')])),
      messageRow(assistantMessage('a2', [textPart('Done.')])),
      messageRow(userMessage('u2')),
      messageRow(assistantMessage('a3', [textPart('Second — chat only.')])),
    ]

    const result = applyTurnFolds(rows, settledInput({ settledRunDurationMs: null }))

    expect(result[1]).toMatchObject({ type: 'turn-fold', label: 'Worked' })
  })

  it('keeps carve-out rows visible while the turn folds around them', () => {
    const worktreeRow: ChatRow = {
      type: 'worktree-launch',
      id: 'worktree-launch:u1',
      sessionId: 'session-1',
      launch: {
        status: 'complete',
        stage: 'starting-task',
        startedAt: 1,
        updatedAt: 2,
        details: ['Created ow/session-1 from feature/source'],
      },
    }
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      worktreeRow,
      messageRow(assistantMessage('a1', [toolCallPart('t1')])),
      messageRow(assistantMessage('a2', [textPart('Done.')])),
    ]

    const result = applyTurnFolds(rows, settledInput())

    expect(result).toHaveLength(4)
    expect(result[1]).toMatchObject({ type: 'turn-fold' })
    expect(result[2]).toBe(worktreeRow)
  })

  it('folds a settled Waggle turn as one agent-colored unit inside its section', () => {
    const waggleMeta: WaggleMessageMetadata = fromPartial({
      agentLabel: 'Scout',
      agentColor: 'emerald',
      turnNumber: 2,
      agentIndex: 0,
    })
    const waggleRow: ChatRow = {
      type: 'waggle-turn',
      id: 'waggle-turn:s:2:0:a1',
      agentColor: 'emerald',
      turnDividerProps: {
        turnNumber: 2,
        agentLabel: 'Scout',
        agentColor: 'emerald',
      },
      messages: [
        { ...messageRow(assistantMessage('a1', [toolCallPart('t1')])), waggleMeta },
        { ...messageRow(assistantMessage('a2', [textPart('Scout done.')])), waggleMeta },
      ],
    }
    const rows: ChatRow[] = [messageRow(userMessage('u1')), waggleRow]

    const result = applyTurnFolds(rows, settledInput())

    expect(result).toHaveLength(2)
    const foldedWaggle = result[1]
    if (foldedWaggle.type !== 'waggle-turn') throw new Error('expected waggle row')
    expect(foldedWaggle.folded).toBe(true)
    expect(foldedWaggle.foldRow).toMatchObject({
      type: 'turn-fold',
      label: 'Worked for 12s',
      agentColor: 'emerald',
    })
    expect(foldedWaggle.messages).toHaveLength(2)
    expect(foldedWaggle.messages[0]?.turnPresentation).toBeUndefined()
    expect(foldedWaggle.messages[1]?.turnPresentation).toBe('folded')
  })

  it('marks only the last unit interrupted; earlier turns keep Worked labels', () => {
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      messageRow(assistantMessage('a1', [toolCallPart('t1')])),
      messageRow(assistantMessage('a2', [textPart('First turn done.')])),
      messageRow(userMessage('u2')),
      messageRow(assistantMessage('a3', [toolCallPart('t2')])),
      messageRow(assistantMessage('a4', [textPart('Second turn done.')])),
    ]

    const result = applyTurnFolds(
      rows,
      settledInput({
        interrupted: true,
        turnDurationsByAnchorMessageId: new Map([['a2', 8_000]]),
      }),
    )

    const labels = result
      .filter((row): row is Extract<ChatRow, { type: 'turn-fold' }> => row.type === 'turn-fold')
      .map((row) => row.label)
    expect(labels).toEqual(['Worked for 8s', 'You stopped after 12s'])
  })

  it('treats a reset live timer of 0 as unknown duration', () => {
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      messageRow(assistantMessage('a1', [toolCallPart('t1')])),
      messageRow(assistantMessage('a2', [textPart('Done.')])),
    ]

    const result = applyTurnFolds(rows, settledInput({ settledRunDurationMs: 0 }))

    const foldRow = result.find(
      (row): row is Extract<ChatRow, { type: 'turn-fold' }> => row.type === 'turn-fold',
    )
    expect(foldRow?.label).toBe('Worked')
    expect(foldRow?.durationMs).toBeNull()
  })

  it('labels an interrupted turn without a known duration as You stopped this response', () => {
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      messageRow(assistantMessage('a1', [toolCallPart('t1')])),
      messageRow(assistantMessage('a2', [textPart('Partial output.')])),
    ]

    const result = applyTurnFolds(
      rows,
      settledInput({ interrupted: true, settledRunDurationMs: null }),
    )

    const foldRow = result.find(
      (row): row is Extract<ChatRow, { type: 'turn-fold' }> => row.type === 'turn-fold',
    )
    expect(foldRow?.label).toBe('You stopped this response')
  })

  it('does not fold a segment whose terminal message has no renderable text', () => {
    // A turn stopped mid-tool-call: the trailing tool-only assistant message is the
    // segment terminal and lacks text, so nothing folds (deliberate asymmetry with
    // the waggle backward scan — the running tool call must stay visible).
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      messageRow(assistantMessage('a1', [toolCallPart('t1')])),
    ]

    const result = applyTurnFolds(rows, settledInput())

    expect(result).toEqual(rows)
  })

  it('counts thinking parts as foldable work per ADR 0034', () => {
    const rows: ChatRow[] = [
      messageRow(userMessage('u1')),
      messageRow(
        assistantMessage('a1', [{ type: 'thinking', content: 'Reasoning about the approach.' }]),
      ),
      messageRow(assistantMessage('a2', [textPart('Done.')])),
    ]

    const result = applyTurnFolds(rows, settledInput())

    const foldRow = result.find(
      (row): row is Extract<ChatRow, { type: 'turn-fold' }> => row.type === 'turn-fold',
    )
    expect(foldRow).not.toBeUndefined()
  })

  it('keeps an expanded waggle turn fully rendered with its fold row present', () => {
    const waggleMeta: WaggleMessageMetadata = fromPartial({
      agentLabel: 'Scout',
      agentColor: 'emerald',
      turnNumber: 1,
      agentIndex: 0,
    })
    const waggleRow: ChatRow = {
      type: 'waggle-turn',
      id: 'waggle-turn:s:1:0:wa1',
      agentColor: 'emerald',
      turnDividerProps: { turnNumber: 1, agentLabel: 'Scout', agentColor: 'emerald' },
      messages: [
        { ...messageRow(assistantMessage('wa1', [toolCallPart('wt1')])), waggleMeta },
        { ...messageRow(assistantMessage('wa2', [textPart('Waggle output.')])), waggleMeta },
      ],
    }
    const rows: ChatRow[] = [messageRow(userMessage('u1')), waggleRow]

    const result = applyTurnFolds(
      rows,
      settledInput({ expandedTurnKeys: new Set(['waggle-turn:s:1:0:wa1']) }),
    )

    const folded = result.find(
      (row): row is Extract<ChatRow, { type: 'waggle-turn' }> => row.type === 'waggle-turn',
    )
    if (!folded) throw new Error('expected waggle row')
    expect(folded.folded).toBe(false)
    expect(folded.foldRow).not.toBeUndefined()
    expect(folded.messages.every((message) => message.turnPresentation === undefined)).toBe(true)
  })
})
