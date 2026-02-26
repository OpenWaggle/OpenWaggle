import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { QualityPreset } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import { useEffect, useRef } from 'react'

interface SendMessageDeps {
  readonly activeConversationId: ConversationId | null
  readonly projectPath: string | null
  readonly qualityPreset: QualityPreset
  readonly createConversation: (projectPath: string | null) => Promise<ConversationId>
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
    qualityPreset,
    createConversation,
    sendMessage,
    sendWaggleMessage,
    setPendingMessage,
    setPendingWaggleConfig,
  } = deps

  async function handleSend(payload: AgentSendPayload): Promise<void> {
    if (!activeConversationId) {
      setPendingMessage(payload)
      await createConversation(projectPath)
      return
    }
    await sendMessage(payload)
  }

  async function handleSendText(content: string): Promise<void> {
    await handleSend({ text: content, qualityPreset, attachments: [] })
  }

  async function handleSendWaggle(payload: AgentSendPayload, config: WaggleConfig): Promise<void> {
    if (!activeConversationId) {
      setPendingMessage(payload)
      setPendingWaggleConfig(config)
      await createConversation(projectPath)
      return
    }
    await sendWaggleMessage(payload, config)
  }

  return { handleSend, handleSendText, handleSendWaggle }
}

interface UseSendMessageOptions {
  readonly activeConversationId: ConversationId | null
  readonly projectPath: string | null
  readonly qualityPreset: QualityPreset
  readonly createConversation: (projectPath: string | null) => Promise<ConversationId>
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
      if (config) {
        void sendWaggleMessage(payload, config)
      } else {
        void sendMessage(payload)
      }
    }
  }, [activeConversationId, sendMessage, sendWaggleMessage])

  return handlers
}
