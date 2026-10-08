import { showWorkspaceSideTerminal } from '@/shell/workspace-panel-actions'
import { useActionOutputViewStore } from '../state/action-output-view-store'
import { useTerminalStore } from '../state/terminal-store'
import type { TerminalState } from '../state/terminal-store-types'
import { resolveTerminalCommandLayoutOwner } from './terminal-focus-location'
import { terminalInputDispatcher } from './terminal-input-dispatcher'
import { runtimeKeyOf } from './terminal-owner'

interface SessionTerminalCommand {
  /** The Session's terminal runtime owner (ADR 0030). */
  readonly ownerKey: string
  /** Working path the fresh terminal starts in. */
  readonly cwd: string
  readonly command: string
  readonly title: string
}

/**
 * Opens a fresh terminal tab in the Session's visible terminal layout and types `command` into it.
 * The input queues until the pane attaches, so the command runs once the shell is ready. Returns
 * the terminal id, or null when the Session has no terminal owner or Working path.
 */
export function runSessionTerminalCommand(input: SessionTerminalCommand): string | null {
  if (input.ownerKey.length === 0 || input.cwd.length === 0) return null
  const store = useTerminalStore.getState()
  const layoutOwnerKey = resolveTerminalCommandLayoutOwner(input.ownerKey, store.groups)
  store.setPanelOpen(layoutOwnerKey, true)
  if (layoutOwnerKey !== input.ownerKey) showWorkspaceSideTerminal(input.ownerKey)
  useActionOutputViewStore.getState().deactivate(layoutOwnerKey)
  const terminalId = store.createTerminal(layoutOwnerKey, input.cwd)
  if (terminalId === null) return null
  const tab = useTerminalStore
    .getState()
    .groups[layoutOwnerKey]?.tabs.find((candidate) =>
      candidate.panes.some((pane) => pane.terminalId === terminalId),
    )
  if (tab) store.renameTab(layoutOwnerKey, tab.id, input.title)
  const client = terminalInputDispatcher.acquire(input.ownerKey, terminalId)
  client.enqueue(`${input.command}\r`)
  // Queued input keeps the dispatcher state alive until the pane attaches and drains it.
  client.release()
  return terminalId
}

function hasPane(groups: TerminalState['groups'], terminalId: string) {
  return Object.values(groups).some((group) =>
    group.tabs.some((tab) => tab.panes.some((pane) => pane.terminalId === terminalId)),
  )
}

/**
 * How long after the terminal first reports activity a typed command may take to show up in the
 * foreground. The first report comes when the shell spawns, before a slow profile finishes, so
 * this is generous. A command that exits between two activity samples (a fast failure) is never
 * seen, so the watch ends after this instead of leaving the caller waiting until the terminal
 * closes.
 */
export const COMMAND_START_GRACE_MS = 20_000

/**
 * Calls `onFinished` once after a command observed in the terminal's foreground stops running,
 * the shell exits, the user closes the terminal, or no command appears within
 * {@link COMMAND_START_GRACE_MS} of the terminal's first activity report. Returns an unsubscribe function.
 */
export function watchSessionTerminalCommand(
  ownerKey: string,
  terminalId: string,
  onFinished: () => void,
): () => void {
  const runtimeKey = runtimeKeyOf(ownerKey, terminalId)
  let sawCommand = false
  let sawPane = hasPane(useTerminalStore.getState().groups, terminalId)
  let done = false
  let graceTimer: ReturnType<typeof setTimeout> | null = null
  let unsubscribe: () => void = () => undefined
  const stop = () => {
    done = true
    if (graceTimer !== null) clearTimeout(graceTimer)
    unsubscribe()
  }
  const finish = () => {
    if (done) return
    stop()
    onFinished()
  }
  unsubscribe = useTerminalStore.subscribe((state) => {
    const foreground = state.activity[runtimeKey] ?? null
    if (foreground !== null) sawCommand = true
    if (graceTimer === null && !sawCommand && runtimeKey in state.activity) {
      graceTimer = setTimeout(() => {
        if (!sawCommand) finish()
      }, COMMAND_START_GRACE_MS)
    }
    const paneOpen = hasPane(state.groups, terminalId)
    if (paneOpen) sawPane = true
    const exited = state.exits[runtimeKey] !== undefined
    if (exited || (sawCommand && foreground === null) || (sawPane && !paneOpen)) finish()
  })
  return stop
}
