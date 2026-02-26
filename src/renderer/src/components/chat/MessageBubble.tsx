import type { ConversationId } from '@shared/types/brand'
import { generateDisplayName, type SupportedModelId } from '@shared/types/llm'
import type { QuestionAnswer } from '@shared/types/question'
import { askUserArgsSchema } from '@shared/types/question'
import type { WaggleAgentColor } from '@shared/types/waggle'
import { chooseBy } from '@shared/utils/decision'
import type { UIMessage } from '@tanstack/ai-react'
import { Check } from 'lucide-react'
import { AGENT_BORDER_LEFT, AGENT_TEXT } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'
import { StreamingText } from './StreamingText'
import { ToolCallBlock } from './ToolCallBlock'

interface WaggleInfo {
  agentLabel: string
  agentColor: WaggleAgentColor
}

interface MessageBubbleProps {
  message: UIMessage
  isStreaming?: boolean
  assistantModel?: SupportedModelId
  conversationId: ConversationId | null
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
  waggle?: WaggleInfo
}

export function MessageBubble({
  message,
  isStreaming,
  assistantModel,
  waggle,
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
          <div className="text-[14px] leading-[1.5] text-text-primary">
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
    <div
      className={cn('w-full', waggle && `border-l-2 pl-3 ${AGENT_BORDER_LEFT[waggle.agentColor]}`)}
    >
      <div className="flex flex-col gap-2">
        {waggle ? (
          <div>
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium',
                AGENT_TEXT[waggle.agentColor],
                'bg-bg-tertiary/40 border border-border/70',
              )}
            >
              {waggle.agentLabel}
              {assistantModel && ` \u00b7 ${generateDisplayName(assistantModel)}`}
            </span>
          </div>
        ) : assistantModel ? (
          <div>
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] text-text-muted bg-bg-tertiary/40 border border-border/70">
              {generateDisplayName(assistantModel)}
            </span>
          </div>
        ) : null}

        {message.parts.map((part, i) =>
          chooseBy(part, 'type')
            .case('text', (value) =>
              value.content.trim() ? (
                <StreamingText
                  key={`${message.id}-text-${String(i)}`}
                  text={value.content}
                  isStreaming={isStreaming}
                />
              ) : null,
            )
            .case('tool-call', (value) => {
              // Synthetic turn-boundary markers are only structural separators
              // for Waggle streaming — never render them as tool calls.
              if (value.name === '_turnBoundary') return null

              if (value.name === 'askUser') {
                const result = toolResults.get(value.id)
                if (result) {
                  // Answered — show compact muted summary
                  const questionCount = countQuestions(value.arguments)
                  return (
                    <div
                      key={`tool-${value.id}`}
                      className="flex items-center gap-2 py-0.5 text-[13px]"
                    >
                      <Check className="h-3.5 w-3.5 text-text-muted shrink-0" />
                      <span className="text-text-muted">
                        Answered {questionCount} {questionCount === 1 ? 'question' : 'questions'}
                      </span>
                    </div>
                  )
                }
                // Unanswered — render nothing inline (active prompt renders above composer)
                return null
              }

              return (
                <ToolCallBlock
                  key={`tool-${value.id}`}
                  name={value.name}
                  args={value.arguments}
                  state={value.state}
                  result={toolResults.get(value.id)}
                />
              )
            })
            .case('thinking', () => null)
            .case('tool-result', () => null)
            .catchAll(() => null),
        )}
      </div>
    </div>
  )
}

function countQuestions(argsJson: string): number {
  try {
    const parsed: unknown = JSON.parse(argsJson)
    const result = askUserArgsSchema.safeParse(parsed)
    return result.success ? result.data.questions.length : 1
  } catch {
    return 1
  }
}
