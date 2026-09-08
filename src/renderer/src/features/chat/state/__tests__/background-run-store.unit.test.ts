// @vitest-environment jsdom

import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import type { AgentTransportEvent } from '@shared/types/stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKGROUND_RUN_RECOVERY_STORAGE_KEY } from '../background-run-recovery-storage'
import { useBackgroundRunStore } from '../background-run-store'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    listActiveRuns: vi.fn(async () => []),
    getBackgroundRun: vi.fn(async () => null),
    getSessionDetail: vi.fn(async (): Promise<SessionDetail | null> => null),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

const SESSION_A = SessionId('session-a')
const SESSION_B = SessionId('session-b')

function resetStore() {
  useBackgroundRunStore.setState({
    activeRunIds: new Set(),
    renderSnapshotsBySessionId: new Map(),
    worktreeLaunchBySessionId: new Map(),
    firstSendRecoveryBySessionId: new Map(),
  })
}

function userMessage(id: string, content: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content }],
    createdAt: new Date(1),
  }
}

function assistantTextEvent(messageId: string, delta: string): AgentTransportEvent {
  return {
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: {
      type: 'text_delta',
      contentIndex: 0,
      delta,
    },
    timestamp: Date.now(),
  }
}

function sessionDetail(
  messages: SessionDetail['messages'] = [],
  environmentMode: SessionDetail['environmentMode'] = 'worktree',
): SessionDetail {
  return {
    id: SESSION_A,
    title: 'Session A',
    projectPath: '/repo',
    messages,
    createdAt: 1,
    updatedAt: 2,
    environmentMode,
    worktreePath: '/repo-worktree',
  }
}

describe('useBackgroundRunStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    apiMock.listActiveRuns.mockResolvedValue([])
    apiMock.getBackgroundRun.mockResolvedValue(null)
    apiMock.getSessionDetail.mockResolvedValue(sessionDetail())
    resetStore()
  })

  afterEach(() => {
    resetStore()
  })

  it('applies live render events only to the owning session snapshot', () => {
    useBackgroundRunStore.getState().setRunRenderMessages(SESSION_A, [
      userMessage('user-a', 'Prompt A'),
      {
        id: 'assistant-a',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Session A answer' }],
        createdAt: new Date(2),
      },
    ])
    useBackgroundRunStore
      .getState()
      .setRunRenderMessages(SESSION_B, [userMessage('user-b', 'Prompt B')])

    useBackgroundRunStore
      .getState()
      .applyRunRenderEvent(SESSION_B, assistantTextEvent('assistant-b', 'Session B answer'))

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_A)?.messages).toEqual([
      userMessage('user-a', 'Prompt A'),
      {
        id: 'assistant-a',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Session A answer' }],
        createdAt: new Date(2),
      },
    ])
    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)?.messages).toEqual([
      userMessage('user-b', 'Prompt B'),
      {
        id: 'assistant-b',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Session B answer' }],
        createdAt: expect.any(Date),
      },
    ])
  })

  it('does not create a render snapshot from an event without a session-owned seed', () => {
    useBackgroundRunStore
      .getState()
      .setRunRenderMessages(SESSION_A, [userMessage('user-a', 'Prompt A')])

    useBackgroundRunStore
      .getState()
      .applyRunRenderEvent(SESSION_B, assistantTextEvent('assistant-b', 'Session B answer'))

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)).toBeNull()
    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_A)?.messages).toEqual([
      userMessage('user-a', 'Prompt A'),
    ])
  })

  it('creates a session-owned snapshot when compaction starts without an agent run', () => {
    useBackgroundRunStore.getState().applyRunRenderEvent(SESSION_B, {
      type: 'compaction_start',
      reason: 'manual',
      timestamp: 10,
    })

    expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_B)).toMatchObject({
      messages: [],
      compactionStatus: {
        type: 'compacting',
        reason: 'manual',
        timeline: [{ id: '10:0', phase: 'running', reason: 'manual' }],
      },
    })
  })

  it('retains ordered compaction lifecycle rows across route-owned snapshots', () => {
    useBackgroundRunStore
      .getState()
      .setRunRenderMessages(SESSION_A, [userMessage('user-a', 'Prompt A')])

    useBackgroundRunStore.getState().applyRunRenderEvent(SESSION_A, {
      type: 'compaction_start',
      reason: 'threshold',
      timestamp: 10,
    })
    useBackgroundRunStore.getState().applyRunRenderEvent(SESSION_A, {
      type: 'compaction_end',
      reason: 'threshold',
      result: {},
      aborted: false,
      willRetry: false,
      timestamp: 11,
    })

    expect(
      useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_A)?.compactionStatus,
    ).toEqual({
      type: 'completed',
      reason: 'threshold',
      summaryCountAtStart: 0,
      timeline: [
        {
          id: '10:0',
          phase: 'completed',
          reason: 'threshold',
          summaryCountAtStart: 0,
          expectedSummaryCount: 1,
          messageCountAtStart: 1,
        },
      ],
    })
  })

  it('stores and clears the worktree launch state by owning session', () => {
    const launch: WorktreeLaunchSnapshot = {
      status: 'running',
      stage: 'checking-out-files',
      startedAt: 1,
      updatedAt: 2,
      details: ['Creating ow/session-a from main'],
    }

    useBackgroundRunStore.getState().setWorktreeLaunch(SESSION_A, launch)

    expect(useBackgroundRunStore.getState().getWorktreeLaunch(SESSION_A)).toEqual(launch)
    expect(useBackgroundRunStore.getState().getWorktreeLaunch(SESSION_B)).toBeNull()

    useBackgroundRunStore.getState().setWorktreeLaunch(SESSION_A, null)
    expect(useBackgroundRunStore.getState().getWorktreeLaunch(SESSION_A)).toBeNull()
  })

  it('restores a failed first-send launch and its exact retry payload after renderer reload', async () => {
    const launch: WorktreeLaunchSnapshot = {
      status: 'failed',
      stage: 'checking-out-files',
      startedAt: 1,
      updatedAt: 2,
      details: ['Could not create worktree'],
      errorMessage: 'Could not create worktree',
    }
    const recovery = {
      payload: {
        text: 'Keep this prompt',
        thinkingLevel: 'medium' as const,
        attachments: [],
      },
      waggleConfig: null,
      model: SupportedModelId('openai/gpt-5'),
    }
    useBackgroundRunStore.getState().setWorktreeLaunch(SESSION_A, launch)
    useBackgroundRunStore.getState().setFirstSendRecovery(SESSION_A, recovery)
    expect(window.localStorage.getItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)).not.toBeNull()

    // A renderer reload recreates the in-memory maps while preserving localStorage.
    resetStore()
    await useBackgroundRunStore.getState().initialize()

    expect(useBackgroundRunStore.getState().getWorktreeLaunch(SESSION_A)).toEqual(launch)
    expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.get(SESSION_A)).toEqual(
      recovery,
    )
  })

  it('persists attachment recovery as compact capability references', async () => {
    const extractedText = `large-secret-${'x'.repeat(1024 * 1024)}`
    useBackgroundRunStore.getState().setFirstSendRecovery(SESSION_A, {
      payload: {
        text: 'Review the attachment',
        thinkingLevel: 'medium',
        attachments: [
          {
            id: 'attachment-1',
            kind: 'text',
            origin: 'user-file',
            name: 'large.txt',
            path: '/tmp/large.txt',
            mimeType: 'text/plain',
            sizeBytes: extractedText.length,
            extractedText,
          },
        ],
      },
      waggleConfig: null,
      model: SupportedModelId('openai/gpt-5'),
    })

    const persisted = window.localStorage.getItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)
    expect(persisted).not.toContain('large-secret')
    expect(persisted?.length).toBeLessThan(10_000)

    resetStore()
    await useBackgroundRunStore.getState().initialize()

    expect(
      useBackgroundRunStore.getState().firstSendRecoveryBySessionId.get(SESSION_A)?.payload
        .attachments,
    ).toEqual([expect.objectContaining({ id: 'attachment-1', extractedText: '' })])
  })

  it('preserves first-send recovery received while active-run initialization is in flight', async () => {
    const launch: WorktreeLaunchSnapshot = {
      status: 'running',
      stage: 'checking-out-files',
      startedAt: 1,
      updatedAt: 2,
      details: ['Checking out files'],
    }
    const recovery = {
      payload: {
        text: 'Keep this in-flight prompt',
        thinkingLevel: 'medium' as const,
        attachments: [],
      },
      waggleConfig: null,
      model: SupportedModelId('openai/gpt-5'),
    }

    const initialization = useBackgroundRunStore.getState().initialize()
    useBackgroundRunStore.getState().setWorktreeLaunch(SESSION_A, launch)
    useBackgroundRunStore.getState().setFirstSendRecovery(SESSION_A, recovery)
    await initialization

    expect(useBackgroundRunStore.getState().getWorktreeLaunch(SESSION_A)).toEqual(launch)
    expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.get(SESSION_A)).toEqual(
      recovery,
    )
  })

  it('drops malformed persisted recovery state instead of failing initialization', async () => {
    window.localStorage.setItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY, '{not json')

    await expect(useBackgroundRunStore.getState().initialize()).resolves.toBeUndefined()

    expect(window.localStorage.getItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)).toBeNull()
  })
})
