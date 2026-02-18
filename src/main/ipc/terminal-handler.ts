import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { BrowserWindow, ipcMain } from 'electron'
import { getSafeChildEnv } from '../env'

// node-pty is a native module — dynamically require to avoid bundling issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require('node-pty') as typeof import('node-pty')

interface PtyProcess {
  id: string
  process: ReturnType<typeof pty.spawn>
}

const terminals = new Map<string, PtyProcess>()

function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}

export function registerTerminalHandlers(): void {
  ipcMain.handle('terminal:create', (_event, projectPath: string) => {
    const childEnv = getSafeChildEnv()
    const shell = os.platform() === 'win32' ? 'powershell.exe' : (childEnv.SHELL ?? '/bin/zsh')
    const id = randomUUID()

    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: projectPath || os.homedir(),
      env: childEnv as Record<string, string>,
    })

    proc.onData((data: string) => {
      broadcast('terminal:data', { terminalId: id, data })
    })

    proc.onExit(() => {
      terminals.delete(id)
    })

    terminals.set(id, { id, process: proc })
    return id
  })

  ipcMain.handle('terminal:close', (_event, terminalId: string) => {
    const terminal = terminals.get(terminalId)
    if (terminal) {
      terminal.process.kill()
      terminals.delete(terminalId)
    }
  })

  ipcMain.handle('terminal:resize', (_event, terminalId: string, cols: number, rows: number) => {
    const terminal = terminals.get(terminalId)
    if (terminal) {
      terminal.process.resize(cols, rows)
    }
  })

  ipcMain.on('terminal:write', (_event, terminalId: string, data: string) => {
    const terminal = terminals.get(terminalId)
    if (terminal) {
      terminal.process.write(data)
    }
  })
}

export function cleanupTerminals(): void {
  for (const [id, terminal] of terminals) {
    terminal.process.kill()
    terminals.delete(id)
  }
}
