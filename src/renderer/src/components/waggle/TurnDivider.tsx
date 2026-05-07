import { generateDisplayName, type SupportedModelId } from '@shared/types/llm'
import type { WaggleAgentColor } from '@shared/types/waggle'
import { AGENT_TEXT } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'

interface TurnDividerProps {
  turnNumber: number
  agentLabel: string
  agentColor: WaggleAgentColor
  agentModel?: SupportedModelId
}

export function TurnDivider({ turnNumber, agentLabel, agentColor, agentModel }: TurnDividerProps) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-border" />
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-secondary px-2 py-1 text-[11px] font-medium shadow-sm',
          AGENT_TEXT[agentColor],
        )}
      >
        <span>
          Turn {turnNumber + 1}: {agentLabel}
        </span>
        {agentModel ? (
          <span className="text-text-tertiary">· {generateDisplayName(agentModel)}</span>
        ) : null}
      </span>
      <div className="flex-1 border-t border-border" />
    </div>
  )
}
