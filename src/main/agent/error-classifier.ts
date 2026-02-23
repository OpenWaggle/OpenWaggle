import { classifyErrorMessage, makeErrorInfo } from '@shared/types/errors'

export { makeErrorInfo }

/**
 * Classify an unknown error into a structured `AgentErrorInfo`.
 * Extracts the message from Error objects or stringifies other values,
 * then delegates to the shared `classifyErrorMessage`.
 */
export function classifyAgentError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return classifyErrorMessage(message)
}
