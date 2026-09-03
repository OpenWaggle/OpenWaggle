import { execFile } from 'node:child_process'
import os from 'node:os'
import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalKey } from '@shared/types/terminal'
import { getSafeChildEnv } from '../../env'
import { createLogger } from '../../logger'

const logger = createLogger('terminal-inspector')

const LSOF_MIN_FIELDS = 9
const LSOF_NODE_FIELD = 8
const EXEC_TIMEOUT_MS = 4_000
const PS_COLUMN_COUNT = 4
const NO_TTY_FG_GROUP = -1

/**
 * Shared process-table poll behind process-aware tab titles and port previews
 * (ADR 0030). One snapshot per tick serves every terminal. On POSIX the
 * foreground name is exact: the shell row's `tpgid` is the controlling tty's
 * foreground process group, so the process leading that group is the command
 * the user is interacting with. Windows keeps a nearest-descendant walk.
 * Listening ports come from a periodic socket table scan filtered to the
 * shell's descendant pids. Emits only on change, and skips exec entirely
 * while no terminal is live.
 */

export interface TerminalActivitySnapshot {
  readonly processName: string | null
  readonly ports: readonly number[]
}

export interface InspectorTarget {
  readonly key: TerminalKey
  readonly pid: number
}

export interface TerminalProcessInspector {
  /** Begin polling; the callback fires for each target whose snapshot changed. */
  start(onActivity: (key: TerminalKey, snapshot: TerminalActivitySnapshot) => void): void
  /** Replace the polled target set (live terminal pids). */
  setTargets(targets: Iterable<InspectorTarget>): void
  stop(): void
}

export interface ProcessRow {
  readonly pid: number
  readonly ppid: number
  /** Process group id; POSIX only (-1 on Windows rows). */
  readonly pgid: number
  /** Controlling tty's foreground process group; POSIX only (-1 elsewhere). */
  readonly tpgid: number
  readonly name: string
}

const runCommand = (command: string, args: readonly string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { env: stripUndefined(getSafeChildEnv()), timeout: EXEC_TIMEOUT_MS },
      (error, stdout) => {
        resolve(error ? '' : stdout)
      },
    )
  })

const readProcessTable = async () => {
  if (os.platform() === 'win32') {
    const output = await runCommand('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)" }',
    ])
    const rows = new Map<number, ProcessRow>()
    for (const line of output.split('\n')) {
      const [pid, ppid, name] = line.trim().split('\t')
      const pidNumber = Number(pid)
      const ppidNumber = Number(ppid)
      if (Number.isInteger(pidNumber) && Number.isInteger(ppidNumber) && name) {
        rows.set(pidNumber, {
          pid: pidNumber,
          ppid: ppidNumber,
          pgid: NO_TTY_FG_GROUP,
          tpgid: NO_TTY_FG_GROUP,
          name,
        })
      }
    }
    return rows
  }

  const output = await runCommand('ps', ['-eo', 'pid=,ppid=,pgid=,tpgid=,comm='])
  const rows = new Map<number, ProcessRow>()
  for (const line of output.split('\n')) {
    const row = parsePosixRow(line)
    if (row !== null) rows.set(row.pid, row)
  }
  return rows
}

export function parsePosixRow(line: string): ProcessRow | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  const columns = trimmed.split(/\s+/)
  if (columns.length < PS_COLUMN_COUNT + 1) return null
  const [pidField, ppidField, pgidField, tpgidField] = columns
  const name = columns.slice(PS_COLUMN_COUNT).join(' ')
  const pid = Number(pidField)
  const ppid = Number(ppidField)
  const pgid = Number(pgidField)
  const tpgid = Number(tpgidField)
  if (![pid, ppid, pgid, tpgid].every(Number.isInteger) || name.length === 0) return null
  return { pid, ppid, pgid, tpgid, name: basename(name) }
}

const readListeningPorts = async (): Promise<Map<number, number[]>> => {
  const portsByPid = new Map<number, number[]>()
  const record = (pid: number, port: number) => {
    const ports = portsByPid.get(pid) ?? []
    ports.push(port)
    portsByPid.set(pid, ports)
  }

  if (os.platform() === 'win32') {
    const output = await runCommand('netstat', ['-ano'])
    for (const line of output.split('\n')) {
      if (!line.includes('LISTENING')) continue
      const fields = line.trim().split(/\s+/)
      const pid = Number(fields[fields.length - 1])
      const port = Number(fields[1]?.split(':').pop())
      if (Number.isInteger(pid) && Number.isInteger(port) && port > 0) record(pid, port)
    }
    return portsByPid
  }

  const output = await runCommand('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'])
  for (const line of output.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < LSOF_MIN_FIELDS) continue
    const pid = Number(fields[1])
    const port = Number(fields[LSOF_NODE_FIELD]?.split(':').pop())
    if (Number.isInteger(pid) && Number.isInteger(port) && port > 0) record(pid, port)
  }
  return portsByPid
}

/** Descendant names and pids for one shell pid, nearest first (BFS). */
const collectDescendants = (rootPid: number, rows: Map<number, ProcessRow>) => {
  const childrenByParent = new Map<number, ProcessRow[]>()
  for (const row of rows.values()) {
    const siblings = childrenByParent.get(row.ppid) ?? []
    siblings.push(row)
    childrenByParent.set(row.ppid, siblings)
  }

  const names: string[] = []
  const pids = new Set<number>()
  let frontier = [rootPid]
  while (frontier.length > 0) {
    const next: number[] = []
    for (const pid of frontier) {
      for (const child of childrenByParent.get(pid) ?? []) {
        if (pids.has(child.pid)) continue
        pids.add(child.pid)
        names.push(child.name)
        next.push(child.pid)
      }
    }
    frontier = next
  }
  return { names, pids }
}

/**
 * Foreground command name for one shell: exact via the tty's foreground
 * process group (the shell row's tpgid — the group leader's name, or any live
 * member of that group when the leader already exited), falling back to the
 * nearest descendant when tpgid is unavailable (Windows, detached ttys).
 */
export function resolveForegroundName(shellPid: number, rows: Map<number, ProcessRow>) {
  const shell = rows.get(shellPid)
  if (shell === undefined || shell.tpgid === NO_TTY_FG_GROUP) {
    return collectDescendants(shellPid, rows).names[0] ?? null
  }

  const leader = rows.get(shell.tpgid)
  if (leader !== undefined) return leader.name
  for (const row of rows.values()) {
    if (row.pgid === shell.tpgid) return row.name
  }
  return collectDescendants(shellPid, rows).names[0] ?? null
}

export function makeTerminalProcessInspector(): TerminalProcessInspector {
  let timer: NodeJS.Timeout | null = null
  let onActivity: ((key: TerminalKey, snapshot: TerminalActivitySnapshot) => void) | null = null
  let pollInFlight = false
  let lastPortScan = 0
  const targetPids = new Map<TerminalKey, number>()
  const lastSnapshot = new Map<TerminalKey, TerminalActivitySnapshot>()

  const emitIfChanged = (key: TerminalKey, snapshot: TerminalActivitySnapshot) => {
    const previous = lastSnapshot.get(key)
    if (
      previous !== undefined &&
      previous.processName === snapshot.processName &&
      samePorts(previous.ports, snapshot.ports)
    ) {
      return
    }
    lastSnapshot.set(key, snapshot)
    onActivity?.(key, snapshot)
  }

  const tick = async (): Promise<void> => {
    if (onActivity === null || pollInFlight || targetPids.size === 0) return
    pollInFlight = true
    try {
      const rows = await readProcessTable()
      const shouldScanPorts = Date.now() - lastPortScan >= TERMINAL.PORT_SCAN_POLL_MS
      const portsByPid = shouldScanPorts ? await readListeningPorts() : null
      if (shouldScanPorts) lastPortScan = Date.now()

      for (const [key, pid] of targetPids) {
        const { pids } = collectDescendants(pid, rows)
        const ports =
          portsByPid === null
            ? (lastSnapshot.get(key)?.ports ?? [])
            : collectPorts(pids, portsByPid)
        emitIfChanged(key, { processName: resolveForegroundName(pid, rows), ports })
      }
    } catch (error) {
      logger.debug('Terminal process poll skipped', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      pollInFlight = false
    }
  }

  return {
    start(activities) {
      onActivity = activities
      if (timer !== null) return
      timer = setInterval(() => {
        void tick()
      }, TERMINAL.ACTIVITY_POLL_MS)
      timer.unref?.()
    },
    setTargets(targets) {
      targetPids.clear()
      for (const target of targets) targetPids.set(target.key, target.pid)
      if (targetPids.size === 0) {
        for (const key of [...lastSnapshot.keys()]) {
          if (!targetPids.has(key)) lastSnapshot.delete(key)
        }
      }
    },
    stop() {
      onActivity = null
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      lastSnapshot.clear()
      targetPids.clear()
    },
  }
}

function collectPorts(pids: Set<number>, portsByPid: Map<number, number[]>) {
  const ports = new Set<number>()
  for (const pid of pids) {
    for (const port of portsByPid.get(pid) ?? []) ports.add(port)
  }
  return [...ports].sort((a, b) => a - b)
}

function samePorts(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.every((port, index) => port === b[index])
}

function basename(command: string) {
  const normalized = command.replaceAll('\\', '/')
  const lastSegment = normalized.split('/').pop() ?? command
  return lastSegment.replace(/\.(exe|cmd|bat)$/i, '')
}

function stripUndefined(env: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(env).filter((entry) => entry[1] !== undefined))
}
