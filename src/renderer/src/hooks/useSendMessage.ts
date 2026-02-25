import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { MultiAgentConfig } from '@shared/types/multi-agent'
import type { QualityPreset } from '@shared/types/settings'
import { useEffect, useRef } from 'react'

interface SendMessageDeps {
  readonly activeConversationId: ConversationId | null
  readonly projectPath: string | null
  readonly qualityPreset: QualityPreset
  readonly createConversation: (projectPath: string | null) => Promise<ConversationId>
  readonly sendMessage: (payload: AgentSendPayload) => Promise<void>
  readonly sendMultiAgentMessage: (
    payload: AgentSendPayload,
    config: MultiAgentConfig,
  ) => Promise<void>
  readonly setPendingMessage: (payload: AgentSendPayload | null) => void
  readonly setPendingMultiAgentConfig: (config: MultiAgentConfig | null) => void
}

interface SendMessageHandlers {
  readonly handleSend: (payload: AgentSendPayload) => Promise<void>
  readonly handleSendText: (content: string) => Promise<void>
  readonly handleSendMultiAgent: (
    payload: AgentSendPayload,
    config: MultiAgentConfig,
  ) => Promise<void>
}

/** Pure factory — testable without React. */
export function createSendHandlers(deps: SendMessageDeps): SendMessageHandlers {
  const {
    activeConversationId,
    projectPath,
    qualityPreset,
    createConversation,
    sendMessage,
    sendMultiAgentMessage,
    setPendingMessage,
    setPendingMultiAgentConfig,
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

  async function handleSendMultiAgent(
    payload: AgentSendPayload,
    config: MultiAgentConfig,
  ): Promise<void> {
    if (!activeConversationId) {
      setPendingMessage(payload)
      setPendingMultiAgentConfig(config)
      await createConversation(projectPath)
      return
    }
    await sendMultiAgentMessage(payload, config)
  }

  return { handleSend, handleSendText, handleSendMultiAgent }
}

interface UseSendMessageOptions {
  readonly activeConversationId: ConversationId | null
  readonly projectPath: string | null
  readonly qualityPreset: QualityPreset
  readonly createConversation: (projectPath: string | null) => Promise<ConversationId>
  readonly sendMessage: (payload: AgentSendPayload) => Promise<void>
  readonly sendMultiAgentMessage: (
    payload: AgentSendPayload,
    config: MultiAgentConfig,
  ) => Promise<void>
}

/** Hook wrapper — manages the pending-message ref and dispatch effect. */
export function useSendMessage(options: UseSendMessageOptions): SendMessageHandlers {
  const { activeConversationId, sendMessage, sendMultiAgentMessage, ...rest } = options
  const pendingMessage = useRef<AgentSendPayload | null>(null)
  const pendingMultiAgentConfig = useRef<MultiAgentConfig | null>(null)

  const handlers = createSendHandlers({
    ...rest,
    activeConversationId,
    sendMessage,
    sendMultiAgentMessage,
    setPendingMessage: (payload) => {
      pendingMessage.current = payload
    },
    setPendingMultiAgentConfig: (config) => {
      pendingMultiAgentConfig.current = config
    },
  })

  // Dispatch pending message when a conversation becomes active
  useEffect(() => {
    if (activeConversationId && pendingMessage.current) {
      const payload = pendingMessage.current
      const config = pendingMultiAgentConfig.current
      pendingMessage.current = null
      pendingMultiAgentConfig.current = null
      if (config) {
        void sendMultiAgentMessage(payload, config)
      } else {
        void sendMessage(payload)
      }
    }
  }, [activeConversationId, sendMessage, sendMultiAgentMessage])

  return handlers
}
