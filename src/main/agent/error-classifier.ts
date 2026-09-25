import { classifyErrorMessage, makeErrorInfo } from '@shared/types/errors'
import { describeError } from '../utils/describe-error'

export { makeErrorInfo }

/**
 * Classify an unknown error into a structured `AgentErrorInfo`.
 * Extracts the message from Error objects, or describes tagged errors and other values,
 * then delegates to the shared `classifyErrorMessage`.
 */
export function classifyAgentError(error: unknown) {
  // Tagged errors carry an empty `message`; their tag, operation, and cause are the detail.
  const message = error instanceof Error && error.message ? error.message : describeError(error)
  return classifyErrorMessage(message)
}
