import type { AgentStatus, AgentStreamEvent, Message, MessagePart } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import { MessageId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface ChatState {
  // Conversation list
  conversations: ConversationSummary[]
  activeConversationId: ConversationId | null
  activeConversation: Conversation | null

  // Streaming state
  status: AgentStatus
  streamingText: string
  streamingParts: MessagePart[]

  // Actions
  loadConversations: () => Promise<void>
  createConversation: (
    model: SupportedModelId,
    projectPath: string | null,
  ) => Promise<ConversationId>
  setActiveConversation: (id: ConversationId | null) => Promise<void>
  deleteConversation: (id: ConversationId) => Promise<void>
  sendMessage: (content: string, model: SupportedModelId) => Promise<void>
  cancelAgent: () => void

  // Internal — called by the agent event listener
  handleAgentEvent: (event: AgentStreamEvent) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  status: 'idle',
  streamingText: '',
  streamingParts: [],

  async loadConversations() {
    const conversations = await api.listConversations()
    set({ conversations })
  },

  async createConversation(model: SupportedModelId, projectPath: string | null) {
    const conv = await api.createConversation(model, projectPath)
    await get().loadConversations()
    set({ activeConversationId: conv.id, activeConversation: conv })
    return conv.id
  },

  async setActiveConversation(id: ConversationId | null) {
    if (!id) {
      set({ activeConversationId: null, activeConversation: null })
      return
    }
    const conv = await api.getConversation(id)
    set({ activeConversationId: id, activeConversation: conv })
  },

  async deleteConversation(id: ConversationId) {
    await api.deleteConversation(id)
    const { activeConversationId } = get()
    if (activeConversationId === id) {
      set({ activeConversationId: null, activeConversation: null })
    }
    await get().loadConversations()
  },

  async sendMessage(content: string, model: SupportedModelId) {
    const { activeConversationId, activeConversation } = get()
    if (!activeConversationId || !activeConversation) return

    // Add user message to local state immediately
    const userMessage: Message = {
      id: MessageId(crypto.randomUUID()),
      role: 'user',
      parts: [{ type: 'text', text: content }],
      createdAt: Date.now(),
    }

    set({
      activeConversation: {
        ...activeConversation,
        messages: [...activeConversation.messages, userMessage],
      },
      status: 'streaming',
      streamingText: '',
      streamingParts: [],
    })

    await api.sendMessage(activeConversationId, content, model)
  },

  cancelAgent() {
    api.cancelAgent()
    set({ status: 'idle' })
  },

  handleAgentEvent(event: AgentStreamEvent) {
    const state = get()

    switch (event.type) {
      case 'text-delta': {
        set({
          streamingText: state.streamingText + event.delta,
        })
        break
      }

      case 'tool-call-start': {
        set({
          status: 'tool-executing',
          streamingParts: [
            ...state.streamingParts,
            ...(state.streamingText ? [{ type: 'text' as const, text: state.streamingText }] : []),
            { type: 'tool-call' as const, toolCall: event.toolCall },
          ],
          streamingText: '',
        })
        break
      }

      case 'tool-call-result': {
        const result = event.toolResult
        set({
          status: 'streaming',
          streamingParts: [
            ...state.streamingParts,
            { type: 'tool-result' as const, toolResult: result },
          ],
        })
        break
      }

      case 'finish': {
        // Reload the conversation to get the full persisted state
        const { activeConversationId, loadConversations, setActiveConversation } = get()
        set({ status: 'idle', streamingText: '', streamingParts: [] })

        if (activeConversationId) {
          setActiveConversation(activeConversationId)
          loadConversations()
        }
        break
      }

      case 'error': {
        set({ status: 'error', streamingText: '' })
        break
      }
    }
  },
}))
