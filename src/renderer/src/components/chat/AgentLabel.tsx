import { generateDisplayName, type SupportedModelId } from '@shared/types/llm'
import { AGENT_TEXT } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'
import type { WaggleInfo } from './AssistantMessageBubble'

interface AgentLabelProps {
  assistantModel?: SupportedModelId
  waggle?: WaggleInfo
}

export function AgentLabel({ assistantModel, waggle }: AgentLabelProps): React.JSX.Element | null {
  if (waggle) {
    return (
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
    )
  }

  if (assistantModel) {
    return (
      <div>
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] text-text-muted bg-bg-tertiary/40 border border-border/70">
          {generateDisplayName(assistantModel)}
        </span>
      </div>
    )
  }

  return null
}
