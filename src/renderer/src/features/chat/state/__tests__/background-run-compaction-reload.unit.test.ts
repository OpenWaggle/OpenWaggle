// @vitest-environment jsdom

import type { ActiveRunInfo, BackgroundRunSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundRunStore } from '../background-run-store'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    listActiveRuns: vi.fn<() => Promise<ActiveRunInfo[]>>(async () => []),
    getBackgroundRun: vi.fn<() => Promise<BackgroundRunSnapshot | null>>(async () => null),
    getSessionDetail: vi.fn<() => Promise<SessionDetail | null>>(async () => null),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

const SESSION_ID = SessionId('session-compaction-reload')
const MODEL = SupportedModelId('openai/gpt-5')

function resetStore() {
  useBackgroundRunStore.setState({
    activeRunIds: new Set(),
    renderSnapshotsBySessionId: new Map(),
    worktreeLaunchBySessionId: new Map(),
    firstSendRecoveryBySessionId: new Map(),
  })
}

describe('background run compaction reload', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    apiMock.getBackgroundRun.mockResolvedValue(null)
    resetStore()
  })

  afterEach(resetStore)

  it('restores an in-progress automatic compaction', async () => {
    apiMock.listActiveRuns.mockResolvedValue([
      {
        activity: 'agent-run',
        sessionId: SESSION_ID,
        model: MODEL,
        mode: 'classic',
        startedAt: 1,
        activityEvents: [{ type: 'compaction_start', reason: 'threshold', timestamp: 10 }],
      },
    ])

    await useBackgroundRunStore.getState().initialize()

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_ID)).toMatchObject({
      messages: [],
      compactionStatus: {
        type: 'compacting',
        reason: 'threshold',
        timeline: [{ id: '10:0', phase: 'running', reason: 'threshold' }],
      },
    })
  })

  it('restores an in-progress automatic retry and its compaction timeline', async () => {
    apiMock.listActiveRuns.mockResolvedValue([
      {
        activity: 'agent-run',
        sessionId: SESSION_ID,
        model: MODEL,
        mode: 'classic',
        startedAt: 1,
        activityEvents: [
          { type: 'compaction_start', reason: 'overflow', timestamp: 10 },
          {
            type: 'compaction_end',
            reason: 'overflow',
            result: {},
            aborted: false,
            willRetry: true,
            timestamp: 11,
          },
          {
            type: 'auto_retry_start',
            attempt: 1,
            maxAttempts: 3,
            delayMs: 500,
            errorMessage: 'context overflow',
            timestamp: 12,
          },
        ],
      },
    ])

    await useBackgroundRunStore.getState().initialize()

    expect(
      useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_ID)?.compactionStatus,
    ).toMatchObject({
      type: 'retrying',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 500,
      previousCompactionStatus: {
        type: 'completed',
        timeline: [{ id: '10:0', phase: 'completed', reason: 'overflow' }],
      },
    })
  })
})
