import type { ConversationId } from '@shared/types/brand'
import { generateDisplayName, type SupportedModelId } from '@shared/types/llm'
import type { QuestionAnswer, UserQuestion } from '@shared/types/question'
import type { UIMessage } from '@tanstack/ai-react'
import { AskUserBlock } from './AskUserBlock'
import { StreamingText } from './StreamingText'
import { ToolCallBlock } from './ToolCallBlock'

interface MessageBubbleProps {
  message: UIMessage
  isStreaming?: boolean
  assistantModel?: SupportedModelId
  conversationId: ConversationId | null
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
}

export function MessageBubble({
  message,
  isStreaming,
  assistantModel,
  conversationId,
  onAnswerQuestion,
}: MessageBubbleProps): React.JSX.Element {
  const isUser = message.role === 'user'

  const toolResults = new Map<string, { content: unknown; state: string; error?: string }>()
  for (const part of message.parts) {
    if (part.type === 'tool-result') {
      toolResults.set(part.toolCallId, {
        content: part.content,
        state: part.state,
        error: part.error,
      })
    }
  }

  if (isUser) {
    return (
      /* User msg container — justifyContent: end, width: fill_container */
      <div className="flex justify-end w-full">
        {/* User bubble — cornerRadius [16,16,2,16], fill #1e2229, padding [10,14], stroke #2a3240 1px */}
        <div className="rounded-[16px_16px_2px_16px] bg-bg-hover border border-border-light py-2.5 px-3.5">
          <div className="text-[13px] leading-[1.5] text-text-primary">
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
      </div>
    )
  }

  return (
    /* Assistant msg — width: fill_container, no background */
    <div className="w-full">
      <div className="flex flex-col gap-2">
        {assistantModel && (
          <div>
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] text-text-muted bg-bg-tertiary/40 border border-border/70">
              {generateDisplayName(assistantModel)}
            </span>
          </div>
        )}
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
              if (part.name === 'askUser' && conversationId) {
                let questions: UserQuestion[] = []
                try {
                  const parsed = JSON.parse(part.arguments) as { questions?: UserQuestion[] }
                  questions = parsed.questions ?? []
                } catch {
                  // fallback to empty
                }
                return (
                  <AskUserBlock
                    key={`tool-${part.id}`}
                    questions={questions}
                    result={toolResults.get(part.id)}
                    conversationId={conversationId}
                    onAnswer={onAnswerQuestion}
                  />
                )
              }
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
    </div>
  )
}
