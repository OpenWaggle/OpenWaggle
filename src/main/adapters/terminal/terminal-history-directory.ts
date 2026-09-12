import path from 'node:path'
import { app } from 'electron'

const TERMINAL_LOGS_DIR_NAME = 'terminal-logs'

export function terminalHistoryDirectory() {
  return path.join(app.getPath('userData'), TERMINAL_LOGS_DIR_NAME)
}
