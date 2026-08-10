import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { type ComposerContextStripState, useComposerContextStrip } from '@/features/git'
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
  readonly strip: ComposerContextStripState
  readonly guardedSend: (payload: AgentSendPayload) => Promise<void>
} {
  const projectPath = usePreferencesStore((s) => s.settings.projectPath)
  const defaultEnvironmentMode = usePreferencesStore(
    (s) => s.settings.defaultSessionEnvironmentMode,
  )
  const strip = useComposerContextStrip({
    sessionId: input.activeSessionId,
    projectPath,
    isFirstMessage: input.isFirstMessage,
    session: input.session,
    defaultEnvironmentMode,
  })
  const guardedSend = async (payload: AgentSendPayload) => {
    if (strip.sendPlan.kind === 'blocked') {
      input.onToast(strip.sendPlan.reason)
      return
    }
    await input.onSend(payload)
  }
  return { strip, guardedSend }
}
