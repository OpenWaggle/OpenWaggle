import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import { describe, expect, it } from 'vitest'
import { buildChatRows, createUserMessage } from './useBuildChatRows.test-utils'

const IDLE_PHASE = { current: null, completed: [], totalElapsedMs: 0 }

function rowsFor(input: {
  readonly firstSendPending?: boolean
  readonly isLoading?: boolean
  readonly error?: Error
  readonly worktreeLaunch?: WorktreeLaunchSnapshot | null
  readonly withAssistant?: boolean
}) {
  return buildChatRows({
    messages: [
      createUserMessage('user-1', 'Build it'),
      ...(input.withAssistant
        ? [
            {
              id: 'a-1',
              role: 'assistant' as const,
              parts: [{ type: 'text' as const, content: 'ok' }],
            },
          ]
        : []),
    ],
    isLoading: input.isLoading ?? false,
    error: input.error,
    lastUserMessage: 'Build it',
    dismissedError: null,
    sessionId: 'session-a',
    waggleMetadataLookup: {},
    phase: IDLE_PHASE,
    firstSendPending: input.firstSendPending,
    worktreeLaunch: input.worktreeLaunch,
  })
}

const phaseLabels = (rows: ReturnType<typeof rowsFor>) =>
  rows.flatMap((row) => (row.type === 'phase-indicator' ? [row.label] : []))

describe('buildChatRows first-send status', () => {
  it('says the session is starting while a first send has not reported anything yet', () => {
    expect(phaseLabels(rowsFor({ firstSendPending: true }))).toEqual(['Starting session'])
  })

  it('hands over to the run, a launch card, an error, or the reply', () => {
    expect(phaseLabels(rowsFor({ firstSendPending: true, isLoading: true }))).toEqual(['Thinking'])
    expect(phaseLabels(rowsFor({ firstSendPending: true, error: new Error('no') }))).toEqual([])
    expect(phaseLabels(rowsFor({ firstSendPending: true, withAssistant: true }))).toEqual([])
    const running: WorktreeLaunchSnapshot = {
      status: 'running',
      stage: 'syncing-branch',
      environment: 'local',
      startedAt: 1,
      updatedAt: 1,
      details: [],
      steps: [{ stage: 'syncing-branch', label: 'Pulling latest changes for main', startedAt: 1 }],
    }
    const rows = rowsFor({ firstSendPending: true, worktreeLaunch: running })
    expect(phaseLabels(rows)).toEqual([])
    expect(rows.some((row) => row.type === 'worktree-launch')).toBe(true)
  })

  it('drops a finished local launch and keeps saying the session is starting until Pi runs', () => {
    const rows = rowsFor({
      firstSendPending: true,
      worktreeLaunch: {
        status: 'complete',
        stage: 'starting-task',
        environment: 'local',
        startedAt: 1,
        updatedAt: 2,
        details: [],
      },
    })
    expect(rows.some((row) => row.type === 'worktree-launch')).toBe(false)
    expect(phaseLabels(rows)).toEqual(['Starting session'])
  })

  it('shows nothing extra for an ordinary session without a pending first send', () => {
    expect(phaseLabels(rowsFor({}))).toEqual([])
  })
})
