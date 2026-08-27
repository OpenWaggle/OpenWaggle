import type { AgentSendPayload, AgentSendReport } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { useWaggleStore } from '@/features/waggle/state'
import { useBackgroundRunStore } from '../../state/background-run-store'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    cancelAgent: vi.fn(async () => undefined),
    sendMessage: vi.fn(
      async (
        _sessionId: SessionId,
        _payload: AgentSendPayload,
        _model: SupportedModelId,
      ): Promise<AgentSendReport> => ({ outcome: 'delivered' }),
    ),
    sendWaggleMessage: vi.fn(
      async (
        _sessionId: SessionId,
        _payload: AgentSendPayload,
        _model: SupportedModelId,
        _config: WaggleConfig,
      ): Promise<AgentSendReport> => ({ outcome: 'delivered' }),
    ),
    setSessionWorktreePlan: vi.fn(async () => undefined),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

const { cancelFirstSend, retryFirstSend } = await import('../worktree-launch-recovery')

const SESSION_ID = SessionId('session-recovery')
const MODEL = SupportedModelId('openai/gpt-5')
const PAYLOAD = {
  text: 'Keep this exact prompt',
  thinkingLevel: 'medium' as const,
  attachments: [
    {
      id: 'attachment-1',
      kind: 'text' as const,
      name: 'notes.txt',
      path: '/tmp/notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      extractedText: 'notes',
    },
  ],
}
const WAGGLE_CONFIG: WaggleConfig = {
  mode: 'sequential',
  agents: [
    {
      label: 'Reviewer',
      model: MODEL,
      roleDescription: 'Reviews the work',
      color: 'blue',
    },
    {
      label: 'Critic',
      model: MODEL,
      roleDescription: 'Challenges the work',
      color: 'amber',
    },
  ],
  stop: { primary: 'consensus', maxTurnsSafety: 2 },
}

describe('worktree launch recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBackgroundRunStore.setState({
      worktreeLaunchBySessionId: new Map(),
      firstSendRecoveryBySessionId: new Map(),
      renderSnapshotsBySessionId: new Map(),
    })
    useOptimisticUserMessageStore.setState({ messagesBySessionId: new Map() })
    useComposerStore.getState().reset()
    useWaggleStore.getState().reset()
    useBackgroundRunStore.getState().setFirstSendRecovery(SESSION_ID, {
      payload: PAYLOAD,
      waggleConfig: null,
      model: MODEL,
    })
  })

  it('switches to local mode and retries the exact retained first-send payload once', async () => {
    await retryFirstSend(SESSION_ID, true)

    expect(apiMock.cancelAgent).toHaveBeenCalledWith(SESSION_ID)
    expect(apiMock.setSessionWorktreePlan).toHaveBeenCalledWith(SESSION_ID, {
      environmentMode: 'local',
      baseRef: null,
      startFromOrigin: false,
    })
    expect(apiMock.sendMessage).toHaveBeenCalledOnce()
    expect(apiMock.sendMessage.mock.calls[0]?.[1]).toEqual(PAYLOAD)
    expect(apiMock.sendMessage.mock.calls[0]?.[2]).toBe(MODEL)
    expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.has(SESSION_ID)).toBe(
      false,
    )
  })

  it('cancels the run, removes the optimistic turn, and restores text and attachments', async () => {
    useOptimisticUserMessageStore.getState().add(SESSION_ID, {
      id: 'optimistic-user',
      role: 'user',
      parts: [{ type: 'text', content: PAYLOAD.text }],
    })

    await cancelFirstSend(SESSION_ID)

    expect(apiMock.cancelAgent).toHaveBeenCalledWith(SESSION_ID)
    expect(useOptimisticUserMessageStore.getState().messagesBySessionId.has(SESSION_ID)).toBe(false)
    expect(useComposerStore.getState().input).toBe(PAYLOAD.text)
    expect(useComposerStore.getState().attachments).toEqual(PAYLOAD.attachments)
  })

  it('stops a Waggle collaboration when a retry is refused', async () => {
    useBackgroundRunStore.getState().setFirstSendRecovery(SESSION_ID, {
      payload: PAYLOAD,
      waggleConfig: WAGGLE_CONFIG,
      model: MODEL,
    })
    apiMock.sendWaggleMessage.mockResolvedValueOnce({ outcome: 'refused' })

    await retryFirstSend(SESSION_ID)

    expect(useWaggleStore.getState().status).toBe('stopped')
    expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.has(SESSION_ID)).toBe(true)
  })

  it('stops a Waggle collaboration when retry transport throws', async () => {
    useBackgroundRunStore.getState().setFirstSendRecovery(SESSION_ID, {
      payload: PAYLOAD,
      waggleConfig: WAGGLE_CONFIG,
      model: MODEL,
    })
    apiMock.sendWaggleMessage.mockRejectedValueOnce(new Error('IPC disconnected'))

    await expect(retryFirstSend(SESSION_ID)).rejects.toThrow('IPC disconnected')

    expect(useWaggleStore.getState().status).toBe('stopped')
    expect(useBackgroundRunStore.getState().firstSendRecoveryBySessionId.has(SESSION_ID)).toBe(true)
  })
})
