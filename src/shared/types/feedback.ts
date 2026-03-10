import type { AgentErrorInfo } from './errors'

export type FeedbackCategory = 'bug' | 'feature' | 'question'

export interface FeedbackPayload {
  readonly title: string
  readonly description: string
  readonly category: FeedbackCategory
  readonly includeSystemInfo: boolean
  readonly includeLogs: boolean
  readonly includeErrorContext: boolean
  readonly includeLastMessage: boolean
  readonly includeModelInfo: boolean
  /** Pre-resolved renderer context for attachment sections */
  readonly lastUserMessage?: string
  readonly lastErrorContext?: AgentErrorInfo
  readonly activeModel?: string
  readonly activeProvider?: string
}

export interface GhCliStatus {
  readonly available: boolean
  readonly authenticated: boolean
}

export interface DiagnosticsInfo {
  readonly os: string
  readonly appVersion: string
  readonly electronVersion: string
  readonly nodeVersion: string
  readonly arch: string
}

export interface FeedbackSubmitResult {
  readonly success: boolean
  readonly issueUrl?: string
  readonly error?: string
}
