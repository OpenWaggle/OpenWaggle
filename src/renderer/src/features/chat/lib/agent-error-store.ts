import {
  type AgentErrorInfo,
  classifyErrorMessage,
  isAgentErrorCode,
  makeErrorInfo,
} from '@shared/types/errors'

const lastErrorInfoMap = new Map<string, AgentErrorInfo>()

export function getLastAgentErrorInfo(sessionId: string) {
  return lastErrorInfoMap.get(sessionId) ?? null
}

export function clearLastAgentErrorInfo(sessionId: string) {
  lastErrorInfoMap.delete(sessionId)
}

export function setLastAgentErrorInfo(
  sessionId: string,
  error: { readonly message: string; readonly code?: string },
) {
  const info =
    error.code && isAgentErrorCode(error.code)
      ? makeErrorInfo(error.code, error.message)
      : classifyErrorMessage(error.message)
  lastErrorInfoMap.set(sessionId, info)
}
