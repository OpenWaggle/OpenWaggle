import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import { useEffect } from 'react'
import { useSessionStore } from '@/features/sessions/state'
import { reconcileSetupActionTerminal } from '@/features/terminal'
import { readAgentLoopEventsFromWorkspace } from '../lib/agent-loop-transcript-events'
import { worktreeLaunchFromCustomEvent } from '../lib/worktree-launch-row-model'
import { useBackgroundRunStore } from '../state/background-run-store'

export function reconcileLiveSetupActionTerminals(
  launches: ReadonlyMap<SessionId, WorktreeLaunchSnapshot>,
) {
  for (const [sessionId, launch] of launches) {
    reconcileSetupActionTerminal(String(sessionId), launch.setupAction)
  }
}

export function reconcileDurableSetupActionEvents(
  sessionId: string,
  events: readonly AgentTransportCustomEvent[],
) {
  for (const event of events) {
    const launch = worktreeLaunchFromCustomEvent(event)
    reconcileSetupActionTerminal(sessionId, launch?.setupAction)
  }
}

/** Reconciles live/recovered and durable Setup action terminals into renderer layout state. */
export function useSetupActionTerminalReconciliation() {
  const launches = useBackgroundRunStore((state) => state.worktreeLaunchBySessionId)
  const activeWorkspace = useSessionStore((state) => state.activeWorkspace)

  useEffect(() => {
    reconcileLiveSetupActionTerminals(launches)
  }, [launches])

  useEffect(() => {
    if (activeWorkspace === null) return
    const sessionId = String(activeWorkspace.tree.session.id)
    const events = readAgentLoopEventsFromWorkspace(activeWorkspace).customMessages
    reconcileDurableSetupActionEvents(sessionId, events)
  }, [activeWorkspace])
}
