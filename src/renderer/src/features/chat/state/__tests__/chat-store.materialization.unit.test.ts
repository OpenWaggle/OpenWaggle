import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chat-store'
import {
  invalidateDraftMaterialization,
  takeDraftMaterialization,
} from '../draft-session-materialization'

const api = vi.hoisted(() => ({
  createSession: vi.fn<() => Promise<SessionDetail>>(),
  listSessions: vi.fn(async () => []),
  getSessionTree: vi.fn(async () => null),
}))
vi.mock('@/shared/lib/ipc', () => ({ api }))

function session(id: string): SessionDetail {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/repo',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('canonical draft Session materialization receipt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateDraftMaterialization()
    useChatStore.setState({
      activeSession: null,
      activeSessionId: null,
      draftSession: null,
      sessions: [],
      sessionById: new Map(),
      missingSessionIds: new Set(),
      error: null,
    })
  })

  it('authorizes exactly the originating project and created Session, once', async () => {
    useChatStore.getState().startDraftSession('/repo')
    api.createSession.mockResolvedValue(session('born'))
    await useChatStore.getState().createSession('/repo')
    expect(takeDraftMaterialization('/elsewhere', 'born')).toBe(false)
    expect(takeDraftMaterialization('/repo', 'another-session')).toBe(false)
    expect(takeDraftMaterialization('/repo', 'born')).toBe(true)
    expect(takeDraftMaterialization('/repo', 'born')).toBe(false)
  })

  it('does not create authority on failed creation', async () => {
    useChatStore.getState().startDraftSession('/repo')
    api.createSession.mockRejectedValue(new Error('Creation failed'))
    await expect(useChatStore.getState().createSession('/repo')).rejects.toThrow('Creation failed')
    expect(takeDraftMaterialization('/repo', 'born')).toBe(false)
    expect(useChatStore.getState().draftSession).toEqual({ projectPath: '/repo' })
  })

  it('keeps an explicit model visible after failure and reuses it on retry', async () => {
    const model = SupportedModelId('openai/gpt-5.4')
    useChatStore.getState().startDraftSession('/repo')
    useChatStore.getState().setDraftSelectedModel(model)
    api.createSession.mockRejectedValueOnce(new Error('Creation failed'))

    await expect(useChatStore.getState().createSession('/repo')).rejects.toThrow('Creation failed')
    expect(useChatStore.getState().draftSession).toEqual({
      projectPath: '/repo',
      selectedModel: model,
    })

    api.createSession.mockResolvedValue(session('born'))
    await useChatStore.getState().createSession('/repo')
    expect(api.createSession).toHaveBeenLastCalledWith('/repo', undefined, model)
    expect(useChatStore.getState().draftSession).toBeNull()
  })

  it('freezes the visible model while materialization is pending', async () => {
    const firstModel = SupportedModelId('openai/gpt-5.4')
    const laterModel = SupportedModelId('anthropic/claude-sonnet-4')
    const deferred = Promise.withResolvers<SessionDetail>()
    api.createSession.mockReturnValue(deferred.promise)
    useChatStore.getState().startDraftSession('/repo')
    useChatStore.getState().setDraftSelectedModel(firstModel)

    const creation = useChatStore.getState().createSession('/repo')
    useChatStore.getState().setDraftSelectedModel(laterModel)
    expect(useChatStore.getState().draftSession).toEqual({
      projectPath: '/repo',
      selectedModel: firstModel,
      isMaterializing: true,
    })

    deferred.resolve({ ...session('born'), executionModel: firstModel })
    await creation
    expect(api.createSession).toHaveBeenCalledWith('/repo', undefined, firstModel)
  })

  it('revokes an unused receipt on navigation and cannot reuse it after returning to the draft', async () => {
    api.createSession.mockResolvedValue(session('born'))
    await useChatStore.getState().createSession('/repo')
    useChatStore.getState().startDraftSession('/repo')
    useChatStore.getState().setActiveSession(SessionId('born'))
    expect(takeDraftMaterialization('/repo', 'born')).toBe(false)
  })

  it.each(['existing-session', 'new-draft'] as const)(
    'does not steal %s selection or publish authority when creation completes after navigation',
    async (destination) => {
      const deferred = Promise.withResolvers<SessionDetail>()
      api.createSession.mockReturnValue(deferred.promise)
      useChatStore.getState().startDraftSession('/repo')
      const creation = useChatStore.getState().createSession('/repo')
      if (destination === 'existing-session') {
        useChatStore.getState().upsertSession(session('existing'))
        useChatStore.getState().setActiveSession(SessionId('existing'))
      } else {
        useChatStore.getState().startDraftSession('/repo')
      }
      const selected = useChatStore.getState().activeSessionId
      const draft = useChatStore.getState().draftSession
      deferred.resolve(session('born'))
      await creation
      expect(useChatStore.getState().activeSessionId).toBe(selected)
      expect(useChatStore.getState().draftSession).toBe(draft)
      expect(useChatStore.getState().sessionById.has(SessionId('born'))).toBe(true)
      expect(takeDraftMaterialization('/repo', 'born')).toBe(false)
    },
  )
})
