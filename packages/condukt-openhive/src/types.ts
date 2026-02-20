export type OpenHiveTaskKind = 'analysis' | 'synthesis' | 'repo-edit' | 'general'

export interface OpenHiveChildContextOptions {
  readonly taskKind?: OpenHiveTaskKind
  readonly needsConversationContext?: boolean
  readonly maxContextTokens?: number
}
