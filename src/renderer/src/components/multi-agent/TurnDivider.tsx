import type { AgentColor } from '@shared/types/multi-agent'
import { AGENT_TEXT } from '@/lib/agent-colors'
import { cn } from '@/lib/cn'

interface TurnDividerProps {
  turnNumber: number
  agentLabel: string
  agentColor: AgentColor
  isSynthesis?: boolean
}

export function TurnDivider({
  turnNumber,
  agentLabel,
  agentColor,
  isSynthesis,
}: TurnDividerProps): React.JSX.Element {
  if (isSynthesis) {
    return (
      <div className="flex items-center gap-3 py-3">
        <div className="flex-1 border-t border-[#34d399]/30" />
        <span className="text-[11px] font-semibold text-[#34d399]">Synthesis</span>
        <div className="flex-1 border-t border-[#34d399]/30" />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 border-t border-border" />
      <span className={cn('text-[11px] font-medium', AGENT_TEXT[agentColor])}>
        Turn {turnNumber + 1}: {agentLabel}
      </span>
      <div className="flex-1 border-t border-border" />
    </div>
  )
}
