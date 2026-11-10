import path from 'node:path'
import { appPaths } from '../../desktop-shell/app-paths'

const TERMINAL_LOGS_DIR_NAME = 'terminal-logs'

export function terminalHistoryDirectory() {
  return path.join(appPaths.userData(), TERMINAL_LOGS_DIR_NAME)
}
