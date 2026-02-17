import type { SupportedModelId } from '@shared/types/llm'
import { AlertCircle, Bot, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/shared/Spinner'
import { useAgentChat } from '@/hooks/useAgentChat'
import { useChatStore } from '@/stores/chat-store'
import { InputBar } from './InputBar'
import { MessageBubble } from './MessageBubble'

interface ChatPanelProps {
  model: SupportedModelId
  projectPath: string | null
  hasProject: boolean
}

export function ChatPanel({ model, projectPath, hasProject }: ChatPanelProps): React.JSX.Element {
  const conversationId = useChatStore((s) => s.activeConversationId)
  const conversation = useChatStore((s) => s.activeConversation)
  const createConversation = useChatStore((s) => s.createConversation)

  const { messages, sendMessage, isLoading, stop, error } = useAgentChat(
    conversationId,
    conversation,
    model,
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingMessage = useRef<string | null>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  })

  // Send pending message after conversation is created
  useEffect(() => {
    if (conversationId && pendingMessage.current) {
      const content = pendingMessage.current
      pendingMessage.current = null
      sendMessage(content)
    }
  }, [conversationId, sendMessage])

  async function handleSend(content: string): Promise<void> {
    if (!conversationId) {
      // Create conversation first, store message for next render
      pendingMessage.current = content
      await createConversation(model, projectPath)
      return
    }
    await sendMessage(content)
  }

  // Detect if the last message is an assistant message still streaming
  const lastMsg = messages[messages.length - 1]
  const lastIsStreaming = isLoading && lastMsg?.role === 'assistant'

  // Find last user message for retry functionality
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const lastUserMessage =
    lastUserMsg?.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.content)
      .join('\n') ?? null

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && !isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
                <Bot className="h-8 w-8 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-medium text-text-primary">HiveCode</h2>
                <p className="mt-1 text-sm text-text-secondary max-w-md">
                  {hasProject
                    ? 'Ask me to read, write, or edit files, run commands, or help you understand your codebase.'
                    : 'Select a project folder to get started with file operations, or just ask me anything.'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl py-4">
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={lastIsStreaming && i === messages.length - 1}
              />
            ))}

            {/* Thinking indicator — shown when loading but no assistant content yet */}
            {isLoading &&
              (!lastMsg || lastMsg.role !== 'assistant' || lastMsg.parts.length === 0) && (
                <div className="flex gap-3 px-4 py-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-2 py-1">
                    <Spinner size="sm" className="text-accent" />
                    <span className="text-sm text-text-muted">Thinking...</span>
                  </div>
                </div>
              )}

            {/* Error banner */}
            {error && !isLoading && dismissedError !== error.message && (
              <div className="mx-4 my-3 rounded-lg border border-error/30 bg-error/10 px-4 py-3">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 shrink-0 text-error mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-error">{error.message}</p>
                    <div className="flex gap-2 mt-2">
                      {lastUserMessage && (
                        <button
                          type="button"
                          onClick={() => {
                            setDismissedError(error.message)
                            handleSend(lastUserMessage)
                          }}
                          className="flex items-center gap-1.5 rounded-md bg-error/15 px-2.5 py-1 text-xs font-medium text-error hover:bg-error/25 transition-colors"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Retry
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDismissedError(error.message)}
                        className="flex items-center gap-1.5 rounded-md bg-bg-hover px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <X className="h-3 w-3" />
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <InputBar onSend={handleSend} onCancel={stop} isLoading={isLoading} />
    </div>
  )
}
