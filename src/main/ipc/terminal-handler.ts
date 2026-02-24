import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IPty } from 'node-pty'
import { z } from 'zod'
import { getSafeChildEnv } from '../env'
import { broadcastToWindows } from '../utils/broadcast'
import { typedHandle, typedOn } from './typed-ipc'

// node-pty is a native module loaded via dynamic import at first use
let ptyModule: typeof import('node-pty') | undefined

async function getPty(): Promise<typeof import('node-pty')> {
  if (!ptyModule) {
    ptyModule = await import('node-pty')
  }
  return ptyModule
}

const MAX_TERMINAL_COLS = 500
const MAX_TERMINAL_ROWS = 200
const MAX_TERMINAL_INPUT_BYTES = 16 * 1024

interface PtyProcess {
  id: string
  process: IPty
}

const terminals = new Map<string, PtyProcess>()

const terminalPathSchema = z.string().min(1)
const terminalResizeSchema = z.object({
  cols: z.number().int().min(10).max(MAX_TERMINAL_COLS),
  rows: z.number().int().min(5).max(MAX_TERMINAL_ROWS),
})
const terminalWriteSchema = z.string().max(MAX_TERMINAL_INPUT_BYTES)

function resolveTerminalCwd(projectPath: string): string {
  const candidate = terminalPathSchema.parse(projectPath).trim()
  if (!path.isAbsolute(candidate)) {
    throw new Error('Project path must be absolute.')
  }
  if (!fs.existsSync(candidate)) {
    throw new Error(`Project path does not exist: ${candidate}`)
  }
  const stat = fs.statSync(candidate)
  if (!stat.isDirectory()) {
    throw new Error(`Project path is not a directory: ${candidate}`)
  }
  return candidate
}

export function registerTerminalHandlers(): void {
  typedHandle('terminal:create', async (_event, projectPath: string) => {
    const cwd = resolveTerminalCwd(projectPath)
    const childEnv = getSafeChildEnv()
    const shell = os.platform() === 'win32' ? 'powershell.exe' : (childEnv.SHELL ?? '/bin/zsh')
    const id = randomUUID()
    const pty = await getPty()

    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: Object.fromEntries(
        Object.entries(childEnv).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    })

    proc.onData((data: string) => {
      broadcastToWindows('terminal:data', { terminalId: id, data })
    })

    proc.onExit(() => {
      terminals.delete(id)
    })

    terminals.set(id, { id, process: proc })
    return id
  })

  typedHandle('terminal:close', (_event, terminalId: string) => {
    const terminal = terminals.get(terminalId)
    if (terminal) {
      terminal.process.kill()
      terminals.delete(terminalId)
    }
  })

  typedHandle('terminal:resize', (_event, terminalId: string, cols: number, rows: number) => {
    const parsed = terminalResizeSchema.parse({ cols, rows })
    const terminal = terminals.get(terminalId)
    if (terminal) {
      terminal.process.resize(parsed.cols, parsed.rows)
    }
  })

  typedOn('terminal:write', (_event, terminalId: string, data: string) => {
    let parsedData: string
    try {
      parsedData = terminalWriteSchema.parse(data)
    } catch {
      return
    }
    if (!parsedData) return
    const terminal = terminals.get(terminalId)
    if (terminal) {
      terminal.process.write(parsedData)
    }
  })
}

export function cleanupTerminals(): void {
  for (const [id, terminal] of terminals) {
    terminal.process.kill()
    terminals.delete(id)
  }
}
