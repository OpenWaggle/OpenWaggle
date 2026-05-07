import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSendHandlers } from '../useSendMessage'

type SendDeps = Parameters<typeof createSendHandlers>[0]

function makeDeps(overrides: Partial<SendDeps> = {}): SendDeps {
  return {
    activeSessionId: null,
    projectPath: '/test/project',
    thinkingLevel: 'medium',
    createSession: vi
      .fn<(projectPath: string | null) => Promise<SessionId>>()
      .mockResolvedValue(SessionId('new-session')),
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
    it('with active session: calls sendMessage directly', async () => {
      const convId = SessionId('session-5')
      const deps = makeDeps({ activeSessionId: convId })
      const { handleSend } = createSendHandlers(deps)
      const payload: AgentSendPayload = { text: 'hello', thinkingLevel: 'medium', attachments: [] }

      await handleSend(payload)

      expect(deps.sendMessage).toHaveBeenCalledWith(payload)
      expect(deps.setPendingMessage).not.toHaveBeenCalled()
    })

    it('without active session: sets pending and creates session', async () => {
      const deps = makeDeps({ activeSessionId: null })
      const { handleSend } = createSendHandlers(deps)
      const payload: AgentSendPayload = { text: 'hello', thinkingLevel: 'medium', attachments: [] }

      await handleSend(payload)

      expect(deps.setPendingMessage).toHaveBeenCalledWith(payload)
      expect(deps.createSession).toHaveBeenCalledWith('/test/project')
      expect(deps.sendMessage).not.toHaveBeenCalled()
    })

    it('rejects first-message sends when no project is selected', async () => {
      const deps = makeDeps({
        activeSessionId: null,
        projectPath: null,
      })
      const { handleSend } = createSendHandlers(deps)
      const payload: AgentSendPayload = { text: 'hello', thinkingLevel: 'medium', attachments: [] }

      await expect(handleSend(payload)).rejects.toThrow('Select a project before sending.')

      expect(deps.setPendingMessage).not.toHaveBeenCalled()
      expect(deps.createSession).not.toHaveBeenCalled()
      expect(deps.sendMessage).not.toHaveBeenCalled()
    })
  })

  describe('handleSendText', () => {
    it('wraps handleSend with correct payload shape', async () => {
      const convId = SessionId('session-6')
      const deps = makeDeps({ activeSessionId: convId, thinkingLevel: 'high' })
      const { handleSendText } = createSendHandlers(deps)

      await handleSendText('test message')

      expect(deps.sendMessage).toHaveBeenCalledWith({
        text: 'test message',
        thinkingLevel: 'high',
        attachments: [],
      })
    })
  })
})
