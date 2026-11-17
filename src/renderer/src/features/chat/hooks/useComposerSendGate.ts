import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import {
  pendingWorktreePlanWrite,
  stashDraftWorktreePlan,
  useSessionContextRow,
  worktreePlanKey,
} from '@/features/git'
import { usePreferencesStore } from '@/features/settings/state'
import { withInlineVisualizationContext } from '../state/inline-visualization-state'

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
export function useComposerSendGate(input: UseComposerSendGateInput) {
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
  const guardedSend = (payload: AgentSendPayload) => {
    if (sendBlockedReason !== null) {
      input.onToast(sendBlockedReason)
      return false
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
    const send = () =>
      input.onSend(
        input.activeSessionId
          ? withInlineVisualizationContext(input.activeSessionId, payload)
          : payload,
      )
    /*
     * A pick on an existing Session only reaches the Host through a Session Control handoff, and
     * birth reads the base ref the Host recorded. Sending before that write lands forked the first
     * worktree from the previous ref, so the chosen branch looked ignored.
     *
     * The send stays synchronous when no pick is in flight: callers dispatch from the submit
     * handler, and a wait that always deferred by a tick broke them.
     */
    const pendingPick = pendingWorktreePlanWrite(
      worktreePlanKey({
        sessionId: input.activeSessionId,
        projectPath,
        isFirstMessage: input.isFirstMessage,
      }),
    )
    return pendingPick ? pendingPick.then(send) : send()
  }
  return { strip, guardedSend, sendBlockedReason }
}
