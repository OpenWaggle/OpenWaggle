/**
 * Structured error types for the agent error pipeline.
 *
 * Errors are classified in the main process, transported through IPC
 * with a `code` field, and displayed in the renderer with user-friendly
 * messages and actionable suggestions.
 */

export type AgentErrorCode =
  | 'api-key-invalid'
  | 'session-expired'
  | 'insufficient-credits'
  | 'rate-limited'
  | 'provider-down'
  | 'model-not-found'
  | 'provider-unavailable'
  | 'conversation-not-found'
  | 'no-project'
  | 'persist-failed'
  | 'unknown'

export interface AgentErrorInfo {
  readonly code: AgentErrorCode
  readonly message: string
  readonly userMessage: string
  readonly suggestion?: string
  readonly retryable: boolean
}

// Domain logic re-exported from canonical location
export {
  classifyErrorMessage,
  ERROR_CODE_META,
  extractInnerErrorMessage,
  isAgentErrorCode,
  makeErrorInfo,
} from '../domain/error-classifier'
