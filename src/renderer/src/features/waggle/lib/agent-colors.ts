import type { WaggleAgentColor } from '@shared/types/waggle'

export const AGENT_BG: Record<WaggleAgentColor, string> = {
  blue: 'bg-[#4c8cf5]',
  amber: 'bg-[#f5a623]',
  emerald: 'bg-[#34d399]',
  violet: 'bg-[#a78bfa]',
}

export const AGENT_TEXT: Record<WaggleAgentColor, string> = {
  blue: 'text-[#4c8cf5]',
  amber: 'text-[#f5a623]',
  emerald: 'text-[#34d399]',
  violet: 'text-[#a78bfa]',
}

export const AGENT_BORDER: Record<WaggleAgentColor, string> = {
  blue: 'border-[#4c8cf5]/40',
  amber: 'border-[#f5a623]/40',
  emerald: 'border-[#34d399]/40',
  violet: 'border-[#a78bfa]/40',
}

export const AGENT_BORDER_LEFT: Record<WaggleAgentColor, string> = {
  blue: 'border-l-[#4c8cf5]',
  amber: 'border-l-[#f5a623]',
  emerald: 'border-l-[#34d399]',
  violet: 'border-l-[#a78bfa]',
}
