import { matchBy } from '@diegogbrisa/ts-match'
import type { DesktopBrowserOperation } from '@shared/types/desktop-browser-service'
import type { DesktopServiceCommand } from '@shared/types/desktop-service'
import type { DesktopTerminalInputs } from '@shared/types/desktop-terminal-service'

/**
 * Desktop operations that change nothing on the desktop. When one fails or is interrupted nothing
 * may have happened, so its failure is definite; any other failure leaves the desktop uncertain.
 * `evaluate` runs page code that can change the page, so it is not a read.
 */
const READ_ONLY_BROWSER_OPERATIONS = {
  status: true,
  snapshot: true,
  waitFor: true,
  open: false,
  navigate: false,
  resize: false,
  setAppearance: false,
  click: false,
  type: false,
  press: false,
  scroll: false,
  evaluate: false,
  startRecording: false,
  stopRecording: false,
  inspectOwner: true,
  deleteOwner: false,
} as const satisfies Record<DesktopBrowserOperation | 'inspectOwner' | 'deleteOwner', boolean>

const READ_ONLY_TERMINAL_OPERATIONS = {
  getActivitySnapshot: true,
  assessClose: true,
  open: false,
  restart: false,
  write: false,
  sendInputNow: false,
  acknowledgeOutput: false,
  migrateOwner: false,
  resize: false,
  clear: false,
  close: false,
  closeAllForOwner: false,
  closeAllUnderPath: false,
  attachSurface: false,
  detachTerminal: false,
  detachSurface: false,
  closeAll: false,
} as const satisfies Record<keyof DesktopTerminalInputs, boolean>

export function isReadOnlyDesktopCommand(command: DesktopServiceCommand): boolean {
  return matchBy(command, 'service')
    .with('browser', ({ operation }) => READ_ONLY_BROWSER_OPERATIONS[operation])
    .with('terminal', ({ operation }) => READ_ONLY_TERMINAL_OPERATIONS[operation])
    .with('fence', () => false)
    .exhaustive()
}
