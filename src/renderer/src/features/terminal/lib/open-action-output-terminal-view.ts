import {
  type OpenActionOutputViewInput,
  useActionOutputViewStore,
} from '../state/action-output-view-store'
import { useTerminalStore } from '../state/terminal-store'
import type { ActionOutputRunSummary } from './action-output-view-model'

/**
 * Opens (or focuses) the read-only Action output terminal view of one Project action run in the
 * owner's bottom drawer. It attaches to the existing run: no PTY is mounted and nothing is
 * launched, stopped or restarted.
 */
export function openActionOutputTerminalView(input: OpenActionOutputViewInput) {
  if (input.ownerKey.length === 0 || input.ownerKey.startsWith('draft:')) return false
  const terminal = useTerminalStore.getState()
  const coveredTabId = terminal.groups[input.ownerKey]?.activeTabId ?? null
  const view = useActionOutputViewStore.getState().open(input, coveredTabId)
  if (view === null) return false
  terminal.setPanelOpen(input.ownerKey, true)
  return true
}

/** Lets every open view follow a restart reported by its owner's run list, shown or not. */
export function syncActionOutputViewRuns(
  ownerKey: string,
  runs: readonly ActionOutputRunSummary[],
) {
  useActionOutputViewStore.getState().syncRuns(ownerKey, runs)
}
