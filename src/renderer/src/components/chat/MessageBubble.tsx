import type { ConversationId } from '@shared/types/brand'
import { generateDisplayName, type SupportedModelId } from '@shared/types/llm'
import type { AgentColor } from '@shared/types/multi-agent'
import type { QuestionAnswer } from '@shared/types/question'
import { askUserArgsSchema } from '@shared/types/question'
import type { UIMessage } from '@tanstack/ai-react'
import { Check } from 'lucide-react'
import { AGENT_BORDER_LEFT, AGENT_TEXT } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'
import { StreamingText } from './StreamingText'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'

interface MultiAgentInfo {
  agentLabel: string
  agentColor: AgentColor
}

interface MessageBubbleProps {
  message: UIMessage
  isStreaming?: boolean
  assistantModel?: SupportedModelId
  conversationId: ConversationId | null
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
  multiAgent?: MultiAgentInfo
}

export function MessageBubble({
  message,
  isStreaming,
  assistantModel,
  multiAgent,
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
      className={cn(
        'w-full',
        multiAgent && `border-l-2 pl-3 ${AGENT_BORDER_LEFT[multiAgent.agentColor]}`,
      )}
    >
      <div className="flex flex-col gap-2">
        {multiAgent ? (
          <div>
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium',
                AGENT_TEXT[multiAgent.agentColor],
                'bg-bg-tertiary/40 border border-border/70',
              )}
            >
              {multiAgent.agentLabel}
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
            case 'tool-call': {
              // Synthetic turn-boundary markers are only structural separators
              // for multi-agent streaming — never render them as tool calls.
              if (part.name === '_turnBoundary') return null

              if (part.name === 'askUser') {
                const result = toolResults.get(part.id)
                if (result) {
                  // Answered — show compact muted summary
                  const questionCount = countQuestions(part.arguments)
                  return (
                    <div
                      key={`tool-${part.id}`}
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
                  key={`tool-${part.id}`}
                  name={part.name}
                  args={part.arguments}
                  state={part.state}
                  result={toolResults.get(part.id)}
                />
              )
            }
            case 'thinking': {
              // A thinking part is still streaming only if no non-thinking parts
              // follow it. Once text/tool parts appear after, the reasoning is done.
              let isThinkingDone = false
              for (let j = i + 1; j < message.parts.length; j++) {
                if (message.parts[j].type !== 'thinking') {
                  isThinkingDone = true
                  break
                }
              }
              return part.content.trim() ? (
                <ThinkingBlock
                  key={`${message.id}-thinking-${String(i)}`}
                  content={part.content}
                  isStreaming={isStreaming && !isThinkingDone}
                />
              ) : null
            }
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

function countQuestions(argsJson: string): number {
  try {
    const parsed: unknown = JSON.parse(argsJson)
    const result = askUserArgsSchema.safeParse(parsed)
    return result.success ? result.data.questions.length : 1
  } catch {
    return 1
  }
}
