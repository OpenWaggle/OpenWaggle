import { describe, expect, it } from 'vitest'
import { buildChatRows, createUserMessage } from './useBuildChatRows.test-utils'

const IDLE_PHASE = { current: null, completed: [], totalElapsedMs: 0 }

function rowsFor(input: {
  readonly isFinishing: boolean
  readonly error?: Error
  readonly extensionStatus?: Parameters<typeof buildChatRows>[0]['extensionStatus']
}) {
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
    extensionStatus: input.extensionStatus,
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

  // A slow agent_before_settle check said nothing about why the Run was still finishing.
  it('shows what the Run extensions report on the finishing row', () => {
    const rows = rowsFor({
      isFinishing: true,
      extensionStatus: {
        statuses: [{ key: 'club-hooks', text: 'TypeScript hooks: lint, type-check, tests' }],
        workingMessage: 'Running checks',
      },
    })

    expect(rows.filter((row) => row.type === 'phase-indicator')).toEqual([
      {
        type: 'phase-indicator',
        label: 'Running checks',
        elapsedMs: 0,
        details: [{ key: 'club-hooks', text: 'TypeScript hooks: lint, type-check, tests' }],
      },
    ])
  })

  it('shows nothing once the Run has settled', () => {
    expect(statusRows(rowsFor({ isFinishing: false }))).toEqual([])
  })
})
