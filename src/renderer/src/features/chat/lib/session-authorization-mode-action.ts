import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'

export async function setComposerSessionAuthorizationMode(input: {
  readonly activeSessionId: SessionId | null
  readonly authorizationMode: AgentAuthorizationMode
  readonly setSessionAuthorizationMode: (
    sessionId: SessionId,
    authorizationMode: AgentAuthorizationMode,
  ) => Promise<void>
  readonly showToast: (message: string) => void
}) {
  if (!input.activeSessionId) {
    return
  }

  try {
    await input.setSessionAuthorizationMode(input.activeSessionId, input.authorizationMode)
  } catch (error) {
    input.showToast(error instanceof Error ? error.message : String(error))
  }
}
