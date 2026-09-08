import { useUIStore } from '@/shell/ui-store'
import { confirmAndCloseTerminals, type TerminalCloseTarget } from '../lib/terminal-close'
import { terminalTabTitle } from '../lib/terminal-owner'
import {
  type TerminalGroupState,
  type TerminalTabState,
  useTerminalStore,
} from '../state/terminal-store'

interface TerminalPanelCloseOptions {
  readonly group: TerminalGroupState | undefined
  readonly ownerKey: string
  readonly runtimeOwnerKey: string
}

export function useTerminalPanelCloseActions(options: TerminalPanelCloseOptions) {
  const activity = useTerminalStore((state) => state.activity)
  const closePane = useTerminalStore((state) => state.closePane)
  const closeTab = useTerminalStore((state) => state.closeTab)
  const showToast = useUIStore((state) => state.showToast)

  const closeTargets = async (
    targets: readonly [TerminalCloseTarget, ...TerminalCloseTarget[]],
    removeLayout: () => void,
  ) => {
    try {
      if ((await confirmAndCloseTerminals(options.runtimeOwnerKey, targets)) === 'closed') {
        removeLayout()
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Terminal could not be closed.', 'error')
    }
  }

  const closeOnePane = async (terminalId: string) => {
    const target = paneCloseTarget(options.runtimeOwnerKey, options.group, activity, terminalId)
    await closeTargets([target], () => closePane(options.ownerKey, terminalId))
  }

  const closeOneTab = async (tab: TerminalTabState) => {
    const targets = tabCloseTargets(options.runtimeOwnerKey, options.group, activity, tab)
    const first = targets[0]
    if (first === undefined) return
    await closeTargets([first, ...targets.slice(1)], () => closeTab(options.ownerKey, tab.id))
  }

  return { closeOnePane, closeOneTab }
}

function paneCloseTarget(
  runtimeOwnerKey: string,
  group: TerminalGroupState | undefined,
  activity: Record<string, string | null>,
  terminalId: string,
): TerminalCloseTarget {
  const targetTab = group?.tabs.find((tab) =>
    tab.panes.some((pane) => pane.terminalId === terminalId),
  )
  if (targetTab === undefined) return { terminalId, label: 'terminal' }
  const paneIndex = targetTab.panes.findIndex((pane) => pane.terminalId === terminalId)
  const title = terminalTabTitle(
    runtimeOwnerKey,
    targetTab,
    group?.tabs.indexOf(targetTab) ?? 0,
    activity,
  )
  return {
    terminalId,
    label: targetTab.panes.length === 1 ? title : `${title} pane ${paneIndex + 1}`,
  }
}

function tabCloseTargets(
  runtimeOwnerKey: string,
  group: TerminalGroupState | undefined,
  activity: Record<string, string | null>,
  tab: TerminalTabState,
) {
  const title = terminalTabTitle(runtimeOwnerKey, tab, group?.tabs.indexOf(tab) ?? 0, activity)
  return tab.panes.map((pane, index) => ({
    terminalId: pane.terminalId,
    label: tab.panes.length === 1 ? title : `${title} pane ${index + 1}`,
  }))
}
