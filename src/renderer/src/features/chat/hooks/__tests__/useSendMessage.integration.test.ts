import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSendHandlers } from '../useSendMessage'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    sendMessage: vi.fn(),
    sendWaggleMessage: vi.fn(),
  },
}))

type SendDeps = Parameters<typeof createSendHandlers>[0]

function makeDeps(overrides: Partial<SendDeps> = {}) {
  return {
    activeSessionId: null,
    projectPath: '/test/project',
    thinkingLevel: 'medium',
    createSession: vi.fn<SendDeps['createSession']>().mockResolvedValue(SessionId('new-session')),
    sendMessage: vi.fn<(p: AgentSendPayload) => Promise<void>>().mockResolvedValue(undefined),
    sendMessageToSession: vi.fn<SendDeps['sendMessageToSession']>().mockResolvedValue(undefined),
    sendWaggleMessage: vi
      .fn<(payload: AgentSendPayload) => Promise<void>>()
      .mockResolvedValue(undefined),
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
    })

    it('without active session: creates a session and sends the first message to that exact session', async () => {
      const deps = makeDeps({ activeSessionId: null })
      const { handleSend } = createSendHandlers(deps)
      const payload: AgentSendPayload = { text: 'hello', thinkingLevel: 'medium', attachments: [] }

      await handleSend(payload)

      expect(deps.createSession).toHaveBeenCalledWith('/test/project')
      expect(deps.sendMessageToSession).toHaveBeenCalledWith('new-session', payload, null)
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

  describe('handleSendWaggle', () => {
    it('sends first-message Waggle payloads to the created session instead of the next active session', async () => {
      const deps = makeDeps({ activeSessionId: null })
      const { handleSendWaggle } = createSendHandlers(deps)
      const payload: AgentSendPayload = { text: 'waggle', thinkingLevel: 'medium', attachments: [] }
      const config: WaggleConfig = {
        mode: 'sequential',
        agents: [
          {
            label: 'Planner',
            model: SupportedModelId('openai/gpt-5.5'),
            roleDescription: 'Plan the work',
            color: 'blue',
          },
          {
            label: 'Reviewer',
            model: SupportedModelId('anthropic/claude-sonnet-4-5'),
            roleDescription: 'Review the work',
            color: 'amber',
          },
        ],
        stop: { primary: 'consensus', maxTurnsSafety: 2 },
      }

      await handleSendWaggle(payload, config)

      expect(deps.createSession).toHaveBeenCalledWith('/test/project')
      expect(deps.sendMessageToSession).toHaveBeenCalledWith('new-session', payload, config)
      expect(deps.sendWaggleMessage).not.toHaveBeenCalled()
    })
  })
})
