import type { WaggleAgentColor } from '@shared/types/waggle'

export const AGENT_BG: Record<WaggleAgentColor, string> = {
  blue: 'bg-info',
  amber: 'bg-accent',
  emerald: 'bg-success',
  violet: 'bg-review',
}

export const AGENT_TEXT: Record<WaggleAgentColor, string> = {
  blue: 'text-info-text',
  amber: 'text-accent',
  emerald: 'text-success',
  violet: 'text-review',
}

export const AGENT_BORDER: Record<WaggleAgentColor, string> = {
  blue: 'border-info/40',
  amber: 'border-accent/40',
  emerald: 'border-success/40',
  violet: 'border-review/40',
}

export const AGENT_BORDER_LEFT: Record<WaggleAgentColor, string> = {
  blue: 'border-l-info',
  amber: 'border-l-accent',
  emerald: 'border-l-success',
  violet: 'border-l-review',
}
