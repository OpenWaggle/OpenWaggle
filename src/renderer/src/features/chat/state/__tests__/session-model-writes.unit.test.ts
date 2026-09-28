import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chat-store'
import { resetSessionModelWritesForTests, settledSessionModelWrites } from '../session-model-writes'

const api = vi.hoisted(() => ({
  setSessionModel: vi.fn<(id: SessionId, model: SupportedModelId) => Promise<void>>(),
  getSessionDetail: vi.fn<(id: SessionId) => Promise<SessionDetail | null>>(),
  listSessions: vi.fn(async () => []),
  getSessionTree: vi.fn(async () => null),
}))
vi.mock('@/shared/lib/ipc', () => ({ api }))

const SESSION_ID = SessionId('session-model-writes')
const MODEL_A = SupportedModelId('openai/gpt-5')
const MODEL_B = SupportedModelId('anthropic/claude-sonnet-4-5')
const MODEL_C = SupportedModelId('google/gemini-3-pro')

function detail(executionModel: SupportedModelId): SessionDetail {
  return {
    id: SESSION_ID,
    title: 'Model writes',
    projectPath: '/repo',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    executionModel,
  }
}

function currentModel() {
  return useChatStore.getState().activeSession?.executionModel
}

describe('Session model writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionModelWritesForTests()
    api.setSessionModel.mockResolvedValue(undefined)
    useChatStore.setState({
      activeSessionId: SESSION_ID,
      activeSession: detail(MODEL_A),
      sessionById: new Map([[SESSION_ID, detail(MODEL_A)]]),
      draftSession: null,
      sessions: [],
      missingSessionIds: new Set(),
      error: null,
    })
  })

  it('holds a send until the model it should use is stored by the Session Host', async () => {
    const write = Promise.withResolvers<undefined>()
    api.setSessionModel.mockReturnValue(write.promise)
    api.getSessionDetail.mockResolvedValue(detail(MODEL_B))

    void useChatStore.getState().setSessionModel(SESSION_ID, MODEL_B)
    let sendMayStart = false
    const send = settledSessionModelWrites(SESSION_ID).then(() => {
      sendMayStart = true
    })
    await vi.waitFor(() => expect(api.setSessionModel).toHaveBeenCalledWith(SESSION_ID, MODEL_B))
    expect(sendMayStart).toBe(false)

    write.resolve(undefined)
    await send
    expect(sendMayStart).toBe(true)
    expect(currentModel()).toBe(MODEL_B)
  })

  it('keeps a pending pick over a Session detail read before the write committed', async () => {
    const write = Promise.withResolvers<undefined>()
    api.setSessionModel.mockReturnValue(write.promise)
    api.getSessionDetail.mockResolvedValue(detail(MODEL_B))

    void useChatStore.getState().setSessionModel(SESSION_ID, MODEL_B)
    useChatStore.getState().upsertSession(detail(MODEL_A))
    expect(currentModel()).toBe(MODEL_B)
    expect(useChatStore.getState().sessionById.get(SESSION_ID)?.executionModel).toBe(MODEL_B)

    write.resolve(undefined)
    await settledSessionModelWrites(SESSION_ID)
    expect(currentModel()).toBe(MODEL_B)
  })

  it('stores picks in order and rolls a failed newest pick back to the last stored model', async () => {
    const first = Promise.withResolvers<undefined>()
    api.setSessionModel
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('Host unavailable'))
    api.getSessionDetail.mockResolvedValue(detail(MODEL_B))

    void useChatStore.getState().setSessionModel(SESSION_ID, MODEL_B)
    void useChatStore.getState().setSessionModel(SESSION_ID, MODEL_C)
    expect(currentModel()).toBe(MODEL_C)
    await vi.waitFor(() => expect(api.setSessionModel).toHaveBeenCalledTimes(1))

    first.resolve(undefined)
    await settledSessionModelWrites(SESSION_ID)
    expect(api.setSessionModel.mock.calls).toEqual([
      [SESSION_ID, MODEL_B],
      [SESSION_ID, MODEL_C],
    ])
    expect(currentModel()).toBe(MODEL_B)
  })
})
