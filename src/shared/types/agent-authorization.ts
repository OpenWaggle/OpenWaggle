export const AGENT_AUTHORIZATION_MODES = ['yolo', 'ask-for-approval'] as const

export type AgentAuthorizationMode = (typeof AGENT_AUTHORIZATION_MODES)[number]

export const DEFAULT_AGENT_AUTHORIZATION_MODE: AgentAuthorizationMode = 'yolo'

export const AGENT_AUTHORIZATION_MODE_LABELS = {
  yolo: 'YOLO (Full access)',
  'ask-for-approval': 'Ask for Approval',
} satisfies Record<AgentAuthorizationMode, string>

export function isAgentAuthorizationMode(value: unknown): value is AgentAuthorizationMode {
  return value === 'yolo' || value === 'ask-for-approval'
}
