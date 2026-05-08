import { generateDisplayName, type SupportedModelId } from '@shared/types/llm'
import { AGENT_BG, AGENT_TEXT } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'
import type { WaggleInfo } from './AssistantMessageBubble'

interface AgentLabelProps {
  assistantModel?: SupportedModelId
  waggle?: WaggleInfo
}

export function AgentLabel({ assistantModel, waggle }: AgentLabelProps) {
  if (waggle) {
    return (
      <div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-bg-tertiary/50 px-2 py-1 text-[11px] font-medium shadow-sm',
            AGENT_TEXT[waggle.agentColor],
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', AGENT_BG[waggle.agentColor])} />
          <span>{waggle.agentLabel}</span>
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
