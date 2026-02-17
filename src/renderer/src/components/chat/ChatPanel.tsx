import type { AgentStatus, Message, MessagePart } from '@shared/types/agent'
import { Bot } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Spinner } from '@/components/shared/Spinner'
import { InputBar } from './InputBar'
import { MessageBubble } from './MessageBubble'
import { StreamingText } from './StreamingText'
import { ToolCallBlock } from './ToolCallBlock'

interface ChatPanelProps {
  messages: readonly Message[]
  status: AgentStatus
  streamingText: string
  streamingParts: readonly MessagePart[]
  onSend: (content: string) => void
  onCancel: () => void
  hasProject: boolean
}

export function ChatPanel({
  messages,
  status,
  streamingText,
  streamingParts,
  onSend,
  onCancel,
  hasProject,
}: ChatPanelProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const isActive = status === 'streaming' || status === 'tool-executing'

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && !isActive ? (
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
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {/* Streaming content */}
            {isActive && (
              <div className="flex gap-3 px-4 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  {streamingParts.map((part) => {
                    switch (part.type) {
                      case 'text':
                        return part.text.trim() ? (
                          <StreamingText key={`text-${part.text.slice(0, 20)}`} text={part.text} />
                        ) : null
                      case 'tool-call':
                        return (
                          <ToolCallBlock
                            key={`tool-${part.toolCall.id}`}
                            toolCall={part.toolCall}
                            result={
                              streamingParts.find(
                                (p): p is Extract<MessagePart, { type: 'tool-result' }> =>
                                  p.type === 'tool-result' && p.toolResult.id === part.toolCall.id,
                              )?.toolResult
                            }
                          />
                        )
                      case 'tool-result':
                        return null
                      default:
                        return null
                    }
                  })}

                  {streamingText && <StreamingText text={streamingText} />}

                  {status === 'streaming' && !streamingText && streamingParts.length === 0 && (
                    <div className="flex items-center gap-2 py-1">
                      <Spinner size="sm" className="text-accent" />
                      <span className="text-sm text-text-muted">Thinking...</span>
                    </div>
                  )}

                  {status === 'tool-executing' && (
                    <div className="flex items-center gap-2 py-1">
                      <Spinner size="sm" className="text-accent" />
                      <span className="text-sm text-text-muted">Running tool...</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <InputBar onSend={onSend} onCancel={onCancel} status={status} />
    </div>
  )
}
