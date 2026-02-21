import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { QualityPreset } from '@shared/types/settings'
import { useEffect, useRef } from 'react'

interface SendMessageDeps {
  readonly activeConversationId: ConversationId | null
  readonly projectPath: string | null
  readonly qualityPreset: QualityPreset
  readonly createConversation: (projectPath: string | null) => Promise<ConversationId>
  readonly sendMessage: (payload: AgentSendPayload) => Promise<void>
  readonly setPendingMessage: (payload: AgentSendPayload | null) => void
}

interface SendMessageHandlers {
  readonly handleSend: (payload: AgentSendPayload) => Promise<void>
  readonly handleSendText: (content: string) => Promise<void>
}

/** Pure factory — testable without React. */
export function createSendHandlers(deps: SendMessageDeps): SendMessageHandlers {
  const {
    activeConversationId,
    projectPath,
    qualityPreset,
    createConversation,
    sendMessage,
    setPendingMessage,
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

  return { handleSend, handleSendText }
}

interface UseSendMessageOptions {
  readonly activeConversationId: ConversationId | null
  readonly projectPath: string | null
  readonly qualityPreset: QualityPreset
  readonly createConversation: (projectPath: string | null) => Promise<ConversationId>
  readonly sendMessage: (payload: AgentSendPayload) => Promise<void>
}

/** Hook wrapper — manages the pending-message ref and dispatch effect. */
export function useSendMessage(options: UseSendMessageOptions): SendMessageHandlers {
  const { activeConversationId, sendMessage, ...rest } = options
  const pendingMessage = useRef<AgentSendPayload | null>(null)

  const handlers = createSendHandlers({
    ...rest,
    activeConversationId,
    sendMessage,
    setPendingMessage: (payload) => {
      pendingMessage.current = payload
    },
  })

  // Dispatch pending message when a conversation becomes active
  useEffect(() => {
    if (activeConversationId && pendingMessage.current) {
      const payload = pendingMessage.current
      pendingMessage.current = null
      void sendMessage(payload)
    }
  }, [activeConversationId, sendMessage])

  return handlers
}
