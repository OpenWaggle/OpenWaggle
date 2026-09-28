import { describe, expect, it } from 'vitest'
import { buildChatRows, createUserMessage } from './useBuildChatRows.test-utils'

const IDLE_PHASE = { current: null, completed: [], totalElapsedMs: 0 }

function rowsFor(input: { readonly isFinishing: boolean; readonly error?: Error }) {
  return buildChatRows({
    messages: [
      createUserMessage('user-1', 'Build it'),
      { id: 'a-1', role: 'assistant' as const, parts: [{ type: 'text' as const, content: 'ok' }] },
    ],
    // The transcript stops treating a finishing Run as loading: its reply is complete.
    isLoading: false,
    isFinishing: input.isFinishing,
    error: input.error,
    lastUserMessage: 'Build it',
    dismissedError: null,
    sessionId: 'session-a',
    waggleMetadataLookup: {},
    phase: IDLE_PHASE,
  })
}

const statusRows = (rows: ReturnType<typeof rowsFor>) =>
  rows.flatMap((row) =>
    row.type === 'phase-indicator' ? [row.label] : row.type === 'error' ? ['error'] : [],
  )

/*
 * Between Pi's agent_end and the Host settling the Run, the transcript said "Thinking" over a
 * finished reply (or nothing at all after a failure, which looked idle).
 */
describe('buildChatRows while a Run is finishing', () => {
  it('says the Run is finishing instead of thinking', () => {
    expect(statusRows(rowsFor({ isFinishing: true }))).toEqual(['Finishing'])
  })

  it('keeps showing the failure of a Run that is still settling', () => {
    expect(statusRows(rowsFor({ isFinishing: true, error: new Error('402') }))).toEqual(['error'])
  })

  it('shows nothing once the Run has settled', () => {
    expect(statusRows(rowsFor({ isFinishing: false }))).toEqual([])
  })
})
