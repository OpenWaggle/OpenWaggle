import type { UIMessage } from '@tanstack/ai-react'
import { Bot, User } from 'lucide-react'
import { cn } from '@/lib/cn'
import { StreamingText } from './StreamingText'
import { ToolCallBlock } from './ToolCallBlock'

interface MessageBubbleProps {
  message: UIMessage
  /** Whether this message is still being streamed (skip markdown for active text) */
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user'

  // Build a map of tool-call id → tool-result for matching
  const toolResults = new Map<string, { content: string; state: string; error?: string }>()
  for (const part of message.parts) {
    if (part.type === 'tool-result') {
      toolResults.set(part.toolCallId, {
        content: part.content,
        state: part.state,
        error: part.error,
      })
    }
  }

  return (
    <div className={cn('group flex gap-3 px-4 py-3', isUser ? 'justify-end' : '')}>
      {!isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div
        className={cn(
          'flex flex-col gap-1 min-w-0',
          isUser ? 'items-end max-w-[80%]' : 'max-w-full flex-1',
        )}
      >
        {isUser ? (
          <div className="rounded-2xl rounded-br-md bg-bg-tertiary px-4 py-2.5 text-sm text-text-primary">
            {message.parts
              .filter(
                (p): p is Extract<(typeof message.parts)[number], { type: 'text' }> =>
                  p.type === 'text',
              )
              .map((p, i) => (
                <span key={`${message.id}-text-${String(i)}`}>{p.content}</span>
              ))}
          </div>
        ) : (
          <div className="space-y-1">
            {message.parts.map((part, i) => {
              switch (part.type) {
                case 'text':
                  return part.content.trim() ? (
                    <StreamingText
                      key={`${message.id}-text-${String(i)}`}
                      text={part.content}
                      isStreaming={isStreaming}
                    />
                  ) : null
                case 'tool-call':
                  return (
                    <ToolCallBlock
                      key={`tool-${part.id}`}
                      name={part.name}
                      args={part.arguments}
                      state={part.state}
                      result={toolResults.get(part.id)}
                    />
                  )
                case 'tool-result':
                  return null // Rendered as part of ToolCallBlock
                default:
                  return null
              }
            })}
          </div>
        )}
      </div>

      {isUser && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary text-text-secondary">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  )
}
