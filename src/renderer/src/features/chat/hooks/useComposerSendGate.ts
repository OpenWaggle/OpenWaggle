import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import {
  type SessionContextRowState,
  stashDraftWorktreePlan,
  useSessionContextRow,
} from '@/features/git'
import { usePreferencesStore } from '@/features/settings/state'

interface UseComposerSendGateInput {
  readonly activeSessionId: SessionId | null
  readonly session: SessionDetail | null
  readonly isFirstMessage: boolean
  readonly onSend: (payload: AgentSendPayload) => Promise<void>
  readonly onToast: (message: string) => void
}

/**
 * Wires the composer context strip (WS1b) and gates send: a worktree-mode first
 * send is blocked (with a toast) until a Worktree base ref is resolvable.
 */
export function useComposerSendGate(input: UseComposerSendGateInput): {
  readonly strip: SessionContextRowState
  readonly guardedSend: (payload: AgentSendPayload) => Promise<void>
  /**
   * Why sending is currently refused, or null when it is allowed.
   *
   * Exposed so queueing is gated by the same rule. Only the direct send path used to be checked,
   * so queueing a message against a vanished worktree deferred it past the gate: main then
   * rejected it with a bare thrown error and the message was silently re-enqueued, instead of the
   * user seeing the recover-or-switch notice.
   */
  readonly sendBlockedReason: string | null
} {
  const projectPath = usePreferencesStore((s) => s.settings.projectPath)
  const defaultEnvironmentMode = usePreferencesStore(
    (s) => s.settings.defaultSessionEnvironmentMode,
  )
  const strip = useSessionContextRow({
    sessionId: input.activeSessionId,
    projectPath,
    isFirstMessage: input.isFirstMessage,
    session: input.session,
    defaultEnvironmentMode,
  })
  // Both blocking outcomes stop a send. 'worktree-missing' additionally offers recover-or-switch
  // actions in the context row, so the user is not stuck.
  const sendBlockedReason =
    strip.sendPlan.kind === 'blocked' || strip.sendPlan.kind === 'worktree-missing'
      ? strip.sendPlan.reason
      : null
  const guardedSend = async (payload: AgentSendPayload) => {
    if (sendBlockedReason !== null) {
      input.onToast(sendBlockedReason)
      return
    }
    // Persist the resolved plan onto the draft key so the lazily-created session
    // (created inside onSend) is born with the user's pre-send choice.
    if (input.activeSessionId === null && projectPath) {
      stashDraftWorktreePlan(projectPath, {
        envMode: strip.envMode,
        baseRef: strip.baseRef,
        startFromOrigin: strip.startFromOrigin,
      })
    }
    await input.onSend(payload)
  }
  return { strip, guardedSend, sendBlockedReason }
}
