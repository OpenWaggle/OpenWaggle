import type { Message, MessagePart } from '@shared/types/agent'
import type { ToolCallResult } from '@shared/types/tools'
import { Bot, User } from 'lucide-react'
import { cn } from '@/lib/cn'
import { StreamingText } from './StreamingText'
import { ToolCallBlock } from './ToolCallBlock'

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user'

  // Build a map of tool call id → result for matching
  const toolResults = new Map<string, ToolCallResult>()
  for (const part of message.parts) {
    if (part.type === 'tool-result') {
      toolResults.set(part.toolResult.id, part.toolResult)
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
              .filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text')
              .map((p) => (
                <span key={`${message.id}-${p.text.slice(0, 20)}`}>{p.text}</span>
              ))}
          </div>
        ) : (
          <div className="space-y-1">
            {message.parts.map((part) => {
              switch (part.type) {
                case 'text':
                  return part.text.trim() ? (
                    <StreamingText
                      key={`${message.id}-text-${part.text.slice(0, 20)}`}
                      text={part.text}
                    />
                  ) : null
                case 'tool-call':
                  return (
                    <ToolCallBlock
                      key={`tool-${part.toolCall.id}`}
                      toolCall={part.toolCall}
                      result={toolResults.get(part.toolCall.id)}
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

        {message.model && (
          <span className="text-xs text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
            {message.model}
          </span>
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
