export const AGENT_AUTHORIZATION_MODES = ['yolo', 'ask-for-approval'] as const

export type AgentAuthorizationMode = (typeof AGENT_AUTHORIZATION_MODES)[number]

export const DEFAULT_AGENT_AUTHORIZATION_MODE: AgentAuthorizationMode = 'yolo'

export const AGENT_AUTHORIZATION_MODE_LABELS = {
  yolo: 'YOLO (Full access)',
  'ask-for-approval': 'Ask for Approval',
} satisfies Record<AgentAuthorizationMode, string>

/**
 * Compact labels for the composer control row.
 *
 * The row sits under the prompt beside the model and branch, where horizontal space is scarce and a
 * parenthetical wastes it. The full label still appears whenever the user is choosing, so the
 * meaning is one interaction away rather than lost.
 */
export const AGENT_AUTHORIZATION_MODE_SHORT_LABELS = {
  yolo: 'YOLO',
  'ask-for-approval': 'Ask',
} satisfies Record<AgentAuthorizationMode, string>

export function isAgentAuthorizationMode(value: unknown): value is AgentAuthorizationMode {
  return value === 'yolo' || value === 'ask-for-approval'
}
