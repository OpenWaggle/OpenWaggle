import type { UIMessage } from '@tanstack/ai-react'
import { cn } from '@/lib/cn'
import { StreamingText } from './StreamingText'
import { ToolCallBlock } from './ToolCallBlock'

interface MessageBubbleProps {
  message: UIMessage
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user'

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
    <div className={cn('py-2', isUser && 'flex justify-end')}>
      {isUser ? (
        <div className="max-w-[340px] rounded-[16px_16px_2px_16px] border border-border-light bg-bg-hover px-3.5 py-2.5">
          <div className="text-[13px] leading-relaxed text-text-primary">
            {message.parts
              .filter(
                (p): p is Extract<(typeof message.parts)[number], { type: 'text' }> =>
                  p.type === 'text',
              )
              .map((p, i) => (
                <span key={`${message.id}-text-${String(i)}`}>{p.content}</span>
              ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
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
                return null
              default:
                return null
            }
          })}
        </div>
      )}
    </div>
  )
}
