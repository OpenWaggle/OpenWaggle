import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSendHandlers } from '../useSendMessage'

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    activeConversationId: null as ConversationId | null,
    projectPath: '/test/project' as string | null,
    qualityPreset: 'medium' as const,
    createConversation: vi
      .fn<(p: string | null) => Promise<ConversationId>>()
      .mockResolvedValue('new-conv' as ConversationId),
    sendMessage: vi.fn<(p: AgentSendPayload) => Promise<void>>().mockResolvedValue(undefined),
    setPendingMessage: vi.fn(),
    ...overrides,
  }
}

describe('createSendHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleSend', () => {
    it('with active conversation: calls sendMessage directly', async () => {
      const convId = 'conv-5' as ConversationId
      const deps = makeDeps({ activeConversationId: convId })
      const { handleSend } = createSendHandlers(deps)
      const payload: AgentSendPayload = { text: 'hello', qualityPreset: 'medium', attachments: [] }

      await handleSend(payload)

      expect(deps.sendMessage).toHaveBeenCalledWith(payload)
      expect(deps.setPendingMessage).not.toHaveBeenCalled()
    })

    it('without active conversation: sets pending and creates conversation', async () => {
      const deps = makeDeps({ activeConversationId: null })
      const { handleSend } = createSendHandlers(deps)
      const payload: AgentSendPayload = { text: 'hello', qualityPreset: 'medium', attachments: [] }

      await handleSend(payload)

      expect(deps.setPendingMessage).toHaveBeenCalledWith(payload)
      expect(deps.createConversation).toHaveBeenCalledWith('/test/project')
      expect(deps.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('handleSendText', () => {
    it('wraps handleSend with correct payload shape', async () => {
      const convId = 'conv-6' as ConversationId
      const deps = makeDeps({ activeConversationId: convId, qualityPreset: 'high' as const })
      const { handleSendText } = createSendHandlers(deps)

      await handleSendText('test message')

      expect(deps.sendMessage).toHaveBeenCalledWith({
        text: 'test message',
        qualityPreset: 'high',
        attachments: [],
      })
    })
  })
})
