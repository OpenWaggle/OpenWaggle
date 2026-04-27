import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { ThinkingLevel } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import { useEffect, useRef } from 'react'
import { createRendererLogger } from '@/lib/logger'

const logger = createRendererLogger('use-send-message')

interface SendMessageDeps {
  readonly activeConversationId: ConversationId | null
  readonly projectPath: string | null
  readonly thinkingLevel: ThinkingLevel
  readonly createConversation: (projectPath: string) => Promise<ConversationId>
  readonly sendMessage: (payload: AgentSendPayload) => Promise<void>
  readonly sendWaggleMessage: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
  readonly setPendingMessage: (payload: AgentSendPayload | null) => void
  readonly setPendingWaggleConfig: (config: WaggleConfig | null) => void
}

interface SendMessageHandlers {
  readonly handleSend: (payload: AgentSendPayload) => Promise<void>
  readonly handleSendText: (content: string) => Promise<void>
  readonly handleSendWaggle: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
}

/** Pure factory — testable without React. */
export function createSendHandlers(deps: SendMessageDeps): SendMessageHandlers {
  const {
    activeConversationId,
    projectPath,
    thinkingLevel,
    createConversation,
    sendMessage,
    sendWaggleMessage,
    setPendingMessage,
    setPendingWaggleConfig,
  } = deps

  async function handleSend(payload: AgentSendPayload): Promise<void> {
    if (!activeConversationId) {
      if (!projectPath) {
        throw new Error('Select a project before sending.')
      }
      setPendingMessage(payload)
      try {
        await createConversation(projectPath)
      } catch (error) {
        setPendingMessage(null)
        throw error
      }
      return
    }
    await sendMessage(payload)
  }

  async function handleSendText(content: string): Promise<void> {
    await handleSend({ text: content, thinkingLevel, attachments: [] })
  }

  async function handleSendWaggle(payload: AgentSendPayload, config: WaggleConfig): Promise<void> {
    if (!activeConversationId) {
      if (!projectPath) {
        throw new Error('Select a project before sending.')
      }
      setPendingMessage(payload)
      setPendingWaggleConfig(config)
      try {
        await createConversation(projectPath)
      } catch (error) {
        setPendingMessage(null)
        setPendingWaggleConfig(null)
        throw error
      }
      return
    }
    await sendWaggleMessage(payload, config)
  }

  return { handleSend, handleSendText, handleSendWaggle }
}

interface UseSendMessageOptions {
  readonly activeConversationId: ConversationId | null
  readonly projectPath: string | null
  readonly thinkingLevel: ThinkingLevel
  readonly createConversation: (projectPath: string) => Promise<ConversationId>
  readonly sendMessage: (payload: AgentSendPayload) => Promise<void>
  readonly sendWaggleMessage: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
}

/** Hook wrapper — manages the pending-message ref and dispatch effect. */
export function useSendMessage(options: UseSendMessageOptions): SendMessageHandlers {
  const { activeConversationId, sendMessage, sendWaggleMessage, ...rest } = options
  const pendingMessage = useRef<AgentSendPayload | null>(null)
  const pendingWaggleConfig = useRef<WaggleConfig | null>(null)

  const handlers = createSendHandlers({
    ...rest,
    activeConversationId,
    sendMessage,
    sendWaggleMessage,
    setPendingMessage: (payload) => {
      pendingMessage.current = payload
    },
    setPendingWaggleConfig: (config) => {
      pendingWaggleConfig.current = config
    },
  })

  // Dispatch pending message when a conversation becomes active
  useEffect(() => {
    if (activeConversationId && pendingMessage.current) {
      const payload = pendingMessage.current
      const config = pendingWaggleConfig.current
      pendingMessage.current = null
      pendingWaggleConfig.current = null
      const sendPromise = config ? sendWaggleMessage(payload, config) : sendMessage(payload)
      void sendPromise.catch((error: unknown) => {
        logger.error('Pending first message send failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }
  }, [activeConversationId, sendMessage, sendWaggleMessage])

  return handlers
}
