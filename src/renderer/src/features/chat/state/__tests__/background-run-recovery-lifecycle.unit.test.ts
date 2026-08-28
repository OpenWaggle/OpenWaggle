// @vitest-environment jsdom

import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const SESSION_ID = SessionId('session-a')
const MODEL = SupportedModelId('openai/gpt-5')

function resetStore() {
  useBackgroundRunStore.setState({
    activeRunIds: new Set(),
    renderSnapshotsBySessionId: new Map(),
    worktreeLaunchBySessionId: new Map(),
    firstSendRecoveryBySessionId: new Map(),
  })
}

function sessionDetail(
  messages: SessionDetail['messages'] = [],
  environmentMode: SessionDetail['environmentMode'] = 'worktree',
): SessionDetail {
  return {
    id: SESSION_ID,
    title: 'Session A',
    projectPath: '/repo',
    messages,
    createdAt: 1,
    updatedAt: 2,
    environmentMode,
    worktreePath: '/repo-worktree',
  }
}

function deliveredSession() {
  return sessionDetail([
    {
      id: MessageId('message-a'),
      role: 'user',
      parts: [{ type: 'text', text: 'Delivered prompt' }],
      createdAt: 3,
    },
  ])
}

function setRecovery(text: string) {
  useBackgroundRunStore.getState().setFirstSendRecovery(SESSION_ID, {
    payload: { text, thinkingLevel: 'medium', attachments: [] },
    waggleConfig: null,
    model: MODEL,
  })
}

function setCompleteLaunch(stage: WorktreeLaunchSnapshot['stage'] = 'starting-task') {
  useBackgroundRunStore.getState().setWorktreeLaunch(SESSION_ID, {
    status: 'complete',
    stage,
    startedAt: 1,
    updatedAt: 2,
    details: ['Worktree ready'],
    worktreePath: '/repo-worktree',
  })
}

describe('background first-send recovery lifecycle', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.clearAllMocks()
    apiMock.listActiveRuns.mockResolvedValue([])
    apiMock.getBackgroundRun.mockResolvedValue(null)
    apiMock.getSessionDetail.mockResolvedValue(sessionDetail())
    resetStore()
  })

  it('makes an orphaned completed worktree send actionable', async () => {
    setCompleteLaunch('checking-out-files')
    setRecovery('Recover this prompt')
    resetStore()

    await useBackgroundRunStore.getState().initialize()

    expect(useBackgroundRunStore.getState().getWorktreeLaunch(SESSION_ID)).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('interrupted'),
      }),
    )
    expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.has(SESSION_ID)).toBe(true)
  })

  it('purges retained prompt contents once durable history proves delivery', async () => {
    apiMock.getSessionDetail.mockResolvedValue(deliveredSession())
    setCompleteLaunch('checking-out-files')
    setRecovery('Sensitive retained prompt')
    resetStore()

    await useBackgroundRunStore.getState().initialize()

    expect(useBackgroundRunStore.getState().getWorktreeLaunch(SESSION_ID)).toBeNull()
    expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.has(SESSION_ID)).toBe(
      false,
    )
    expect(window.localStorage.getItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)).toBeNull()
  })

  it('cleans retained first-send contents after terminal durable delivery', async () => {
    apiMock.getSessionDetail.mockResolvedValue(deliveredSession())
    setCompleteLaunch()
    setRecovery('Do not retain me')

    await useBackgroundRunStore.getState().reconcileTerminalRun(SESSION_ID)

    expect(useBackgroundRunStore.getState().getWorktreeLaunch(SESSION_ID)).toBeNull()
    expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.has(SESSION_ID)).toBe(
      false,
    )
    expect(window.localStorage.getItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)).toBeNull()
  })

  it('clears the delivered launch when recovery disappears during reconciliation', async () => {
    let resolveSessionDetail: (session: SessionDetail | null) => void = () => {}
    apiMock.getSessionDetail.mockReturnValueOnce(
      new Promise<SessionDetail | null>((resolve) => {
        resolveSessionDetail = resolve
      }),
    )
    setCompleteLaunch()
    setRecovery('Delivered prompt')

    const reconciliation = useBackgroundRunStore.getState().reconcileTerminalRun(SESSION_ID)
    useBackgroundRunStore.getState().setFirstSendRecovery(SESSION_ID, null)
    resolveSessionDetail(deliveredSession())
    await reconciliation

    expect(useBackgroundRunStore.getState().getWorktreeLaunch(SESSION_ID)).toBeNull()
    expect(window.localStorage.getItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)).toBeNull()
  })

  it('drops an inactive local recovery that has no recovery UI', async () => {
    apiMock.getSessionDetail.mockResolvedValue(sessionDetail([], 'local'))
    setRecovery('Local prompt')
    resetStore()

    await useBackgroundRunStore.getState().initialize()

    expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.has(SESSION_ID)).toBe(
      false,
    )
    expect(window.localStorage.getItem(BACKGROUND_RUN_RECOVERY_STORAGE_KEY)).toBeNull()
  })
})
