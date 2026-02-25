import type { AgentColor } from '@shared/types/multi-agent'

export const AGENT_HEX: Record<AgentColor, string> = {
  blue: '#4c8cf5',
  amber: '#f5a623',
  emerald: '#34d399',
  violet: '#a78bfa',
}

export const AGENT_BG: Record<AgentColor, string> = {
  blue: 'bg-[#4c8cf5]',
  amber: 'bg-[#f5a623]',
  emerald: 'bg-[#34d399]',
  violet: 'bg-[#a78bfa]',
}

export const AGENT_TEXT: Record<AgentColor, string> = {
  blue: 'text-[#4c8cf5]',
  amber: 'text-[#f5a623]',
  emerald: 'text-[#34d399]',
  violet: 'text-[#a78bfa]',
}

export const AGENT_BORDER: Record<AgentColor, string> = {
  blue: 'border-[#4c8cf5]/40',
  amber: 'border-[#f5a623]/40',
  emerald: 'border-[#34d399]/40',
  violet: 'border-[#a78bfa]/40',
}

export const AGENT_BORDER_LEFT: Record<AgentColor, string> = {
  blue: 'border-l-[#4c8cf5]',
  amber: 'border-l-[#f5a623]',
  emerald: 'border-l-[#34d399]',
  violet: 'border-l-[#a78bfa]',
}
