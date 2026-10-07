/**
 * Session-level MCP off. It is Session state only (ADR 0048): it changes no configuration file
 * and lasts while the Session Host runs. Sessions are on unless switched off.
 */
const disabledSessions = new Set<string>()

export function isSessionMcpEnabled(sessionId: string) {
  return !disabledSessions.has(sessionId)
}

export function setSessionMcpEnabled(sessionId: string, enabled: boolean) {
  if (enabled) disabledSessions.delete(sessionId)
  else disabledSessions.add(sessionId)
}
