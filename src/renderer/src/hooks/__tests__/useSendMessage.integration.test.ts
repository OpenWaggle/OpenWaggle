import type { AgentSendPayload } from '@shared/types/agent'
import { ConversationId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSendHandlers } from '../useSendMessage'

type SendDeps = Parameters<typeof createSendHandlers>[0]

function makeDeps(overrides: Partial<SendDeps> = {}): SendDeps {
  return {
    activeConversationId: null,
    projectPath: '/test/project',
    qualityPreset: 'medium',
    createConversation: vi
      .fn<(projectPath: string | null) => Promise<ConversationId>>()
      .mockResolvedValue(ConversationId('new-conv')),
    sendMessage: vi.fn<(p: AgentSendPayload) => Promise<void>>().mockResolvedValue(undefined),
    sendWaggleMessage: vi
      .fn<(payload: AgentSendPayload) => Promise<void>>()
      .mockResolvedValue(undefined),
    setPendingMessage: vi.fn(),
    setPendingWaggleConfig: vi.fn(),
    ...overrides,
  }
}

describe('createSendHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleSend', () => {
    it('with active conversation: calls sendMessage directly', async () => {
      const convId = ConversationId('conv-5')
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

    it('creates the first conversation even when no project is selected', async () => {
      const deps = makeDeps({
        activeConversationId: null,
        projectPath: null,
      })
      const { handleSend } = createSendHandlers(deps)
      const payload: AgentSendPayload = { text: 'hello', qualityPreset: 'medium', attachments: [] }

      await handleSend(payload)

      expect(deps.setPendingMessage).toHaveBeenCalledWith(payload)
      expect(deps.createConversation).toHaveBeenCalledWith(null)
      expect(deps.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('handleSendText', () => {
    it('wraps handleSend with correct payload shape', async () => {
      const convId = ConversationId('conv-6')
      const deps = makeDeps({ activeConversationId: convId, qualityPreset: 'high' })
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
