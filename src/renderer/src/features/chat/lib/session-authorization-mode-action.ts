import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'

export async function setComposerSessionAuthorizationMode(input: {
  readonly activeSessionId: SessionId | null
  /** `null` clears the session override so the session inherits again. */
  readonly authorizationMode: AgentAuthorizationMode | null
  readonly setSessionAuthorizationMode: (
    sessionId: SessionId,
    authorizationMode: AgentAuthorizationMode | null,
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
