import {
  type AgentErrorInfo,
  classifyErrorMessage,
  isAgentErrorCode,
  makeErrorInfo,
} from '@shared/types/errors'

const lastErrorInfoMap = new Map<string, AgentErrorInfo>()

export function getLastAgentErrorInfo(conversationId: string): AgentErrorInfo | null {
  return lastErrorInfoMap.get(conversationId) ?? null
}

export function clearLastAgentErrorInfo(conversationId: string): void {
  lastErrorInfoMap.delete(conversationId)
}

export function setLastAgentErrorInfo(
  conversationId: string,
  error: { readonly message: string; readonly code?: string },
): void {
  const info =
    error.code && isAgentErrorCode(error.code)
      ? makeErrorInfo(error.code, error.message)
      : classifyErrorMessage(error.message)
  lastErrorInfoMap.set(conversationId, info)
}
