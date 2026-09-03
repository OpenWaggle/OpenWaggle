import type { SessionDetail } from '@shared/types/session'
import type { TerminalOwnerKey } from '@shared/types/terminal'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import type { TerminalTabState } from '../state/terminal-store'

/**
 * Which session (or pre-send draft) a terminal group belongs to, and the
 * Working path new terminals start in (ADR 0030): the Session worktree in
 * worktree mode, the opened checkout in local mode, the project path for a
 * draft that has not sent yet.
 */
export interface TerminalOwnerContext {
  readonly ownerKey: TerminalOwnerKey
  readonly defaultCwd: string | null
}

const DRAFT_OWNER_PREFIX = 'draft:'

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
    return { ownerKey: String(activeSession.id), defaultCwd: workingPath }
  }
  if (projectPath === null) return { ownerKey: '', defaultCwd: null }
  return { ownerKey: `${DRAFT_OWNER_PREFIX}${projectPath}`, defaultCwd: projectPath }
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
) {
  if (tab.customName !== null && tab.customName.length > 0) return tab.customName
  const primary = tab.panes[0]
  if (primary !== undefined) {
    const processName = activity[runtimeKeyOf(ownerKey, primary.terminalId)]
    if (processName !== undefined && processName !== null && processName.length > 0) {
      return processName
    }
  }
  return `Terminal ${index + 1}`
}
