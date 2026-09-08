import type { SessionDetail } from '@shared/types/session'
import type { TerminalOwnerKey } from '@shared/types/terminal'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import type { TerminalTabState } from '../state/terminal-store'
import type { TerminalContextProvenance } from './terminal-context'

/**
 * Which session (or pre-send draft) a terminal group belongs to, and the
 * Working path new terminals start in (ADR 0030): the Session worktree in
 * worktree mode, the opened checkout in local mode, the project path for a
 * draft that has not sent yet.
 */
export interface TerminalOwnerContext {
  readonly ownerKey: TerminalOwnerKey
  readonly defaultCwd: string | null
  readonly defaultProvenance: TerminalContextProvenance
}

const DRAFT_OWNER_PREFIX = 'draft:'
const SIDE_PANEL_LAYOUT_PREFIX = 'side-panel:'

/**
 * Renderer-only layout identity for terminals docked in the right panel.
 * Runtime ownership stays on the underlying Session/draft owner so migration,
 * cleanup, history, and remote transport boundaries remain atomic.
 */
export function terminalSidePanelLayoutKey(ownerKey: TerminalOwnerKey): TerminalOwnerKey {
  return ownerKey.length === 0 ? '' : `${SIDE_PANEL_LAYOUT_PREFIX}${ownerKey}`
}

export function terminalOwnerContext(
  activeSession: Pick<
    SessionDetail,
    'id' | 'environmentMode' | 'worktreePath' | 'projectPath'
  > | null,
  projectPath: string | null,
): TerminalOwnerContext {
  if (activeSession !== null) {
    const openedCheckout = activeSession.projectPath ?? projectPath
    const workingPath = resolveSessionWorkingDir(activeSession, openedCheckout)
    return {
      ownerKey: String(activeSession.id),
      defaultCwd: workingPath,
      defaultProvenance:
        activeSession.environmentMode === 'worktree' ? 'session-worktree' : 'opened-checkout',
    }
  }
  if (projectPath === null) {
    return { ownerKey: '', defaultCwd: null, defaultProvenance: 'draft-checkout' }
  }
  return {
    ownerKey: `${DRAFT_OWNER_PREFIX}${projectPath}`,
    defaultCwd: projectPath,
    defaultProvenance: 'draft-checkout',
  }
}

/** Stable transient key for runtime chips (activity, ports, exits). */
export function runtimeKeyOf(ownerKey: TerminalOwnerKey, terminalId: string) {
  return `${ownerKey}::${terminalId}`
}

export function terminalTabTitle(
  ownerKey: TerminalOwnerKey,
  tab: TerminalTabState,
  index: number,
  activity: Record<string, string | null>,
  preferredPaneId?: string | null,
) {
  if (tab.customName !== null && tab.customName.length > 0) return tab.customName
  const preferred = tab.panes.find((pane) => pane.terminalId === preferredPaneId)
  const titledPane = preferred ?? tab.panes[0]
  if (titledPane !== undefined) {
    const processName = activity[runtimeKeyOf(ownerKey, titledPane.terminalId)]
    if (processName !== undefined && processName !== null && processName.length > 0) {
      return processName
    }
  }
  return `Terminal ${index + 1}`
}
