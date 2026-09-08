import type { WorktreeSetupActionTerminal } from '@shared/types/background-run'
import { createProjectActionTerminalEnvironment } from '@shared/utils/terminal-environment'
import { useTerminalStore } from '../state/terminal-store'
import { terminalSidePanelLayoutKey } from './terminal-owner'

function layoutContainingTerminal(ownerKey: string, terminalId: string) {
  const state = useTerminalStore.getState()
  const layouts = [ownerKey, terminalSidePanelLayoutKey(ownerKey)]
  return layouts.find((layoutOwnerKey) =>
    state.groups[layoutOwnerKey]?.tabs.some((tab) =>
      tab.panes.some((pane) => pane.terminalId === terminalId),
    ),
  )
}

/** Idempotently exposes a main-opened worktree Setup action terminal in renderer layout state. */
export function reconcileSetupActionTerminal(
  sessionId: string,
  setupAction: WorktreeSetupActionTerminal | undefined,
) {
  if (setupAction === undefined || sessionId.length === 0) return false
  const layoutOwnerKey = layoutContainingTerminal(sessionId, setupAction.terminalId) ?? sessionId
  const launchEnv = setupAction.projectRoot
    ? createProjectActionTerminalEnvironment({
        projectRoot: setupAction.projectRoot,
        worktreePath: setupAction.cwd,
      })
    : undefined
  useTerminalStore
    .getState()
    .ensureTerminal(layoutOwnerKey, setupAction.terminalId, setupAction.cwd, {
      ...(launchEnv ? { launchEnv } : {}),
      customName: `Setup · ${setupAction.actionName}`,
    })
  return true
}
