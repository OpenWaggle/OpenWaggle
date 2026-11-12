/**
 * The resident memory of a running OpenWaggle app, by process, on macOS, Linux and Windows. It reads
 * the OS process table the way the Electrobun proof does (`ps -A -o pid=,ppid=,rss=`, Windows
 * `Win32_Process.WorkingSetSize`), and adds each process's command line so the total can be split
 * by role. Shell-neutral: it names Electron's Chromium helpers, CEF's and the Bun-run Electrobun
 * processes alike, so both shells' numbers come from the same counting.
 *
 * The app's processes are the launched process and its descendants, plus every process whose
 * command line names the install directory and its descendants: a Session Host that outlived the
 * process that started it (a CLI run) is reparented and is no longer the window's descendant.
 */
import { execFileSync } from 'node:child_process'

export interface ProcessRow {
  readonly pid: number
  readonly ppid: number
  readonly rssBytes: number
  readonly command: string
}

export type ProcessRole =
  | 'main'
  | 'session-host'
  | 'embedding'
  | 'renderer'
  | 'gpu'
  | 'network'
  | 'utility'
  | 'crashpad'
  | 'zygote'
  | 'webview'
  | 'launcher'
  | 'cli'
  | 'child'

export interface RoleTotal {
  readonly count: number
  readonly rssBytes: number
}

export interface AppMemory {
  readonly rssBytes: number
  readonly processCount: number
  readonly byRole: Readonly<Partial<Record<ProcessRole, RoleTotal>>>
  readonly processes: readonly {
    readonly pid: number
    readonly role: ProcessRole
    readonly rssBytes: number
  }[]
}

const KIB = 1024
const EXEC_BUFFER_BYTES = 64 * KIB * KIB
const WINDOWS_PROCESSES =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,ExecutablePath,CommandLine | ConvertTo-Json -Compress'
const POSIX_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u

function numberField(row: object, key: string) {
  const value: unknown = Reflect.get(row, key)
  return typeof value === 'number' ? value : Number(value)
}

function stringField(row: object, key: string) {
  const value: unknown = Reflect.get(row, key)
  return typeof value === 'string' ? value : ''
}

/** Rows of `ConvertTo-Json` output: one object when there is one process, else an array. */
export function parseWindowsProcesses(json: string): ProcessRow[] {
  const parsed: unknown = JSON.parse(json)
  const rows: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return []
    const executable = stringField(row, 'ExecutablePath')
    const commandLine = stringField(row, 'CommandLine')
    return [
      {
        pid: numberField(row, 'ProcessId'),
        ppid: numberField(row, 'ParentProcessId'),
        rssBytes: numberField(row, 'WorkingSetSize'),
        command: commandLine === '' ? executable : commandLine,
      },
    ]
  })
}

/** Rows of `ps -A -o pid=,ppid=,rss=,args=`; `rss` is in KiB. */
export function parsePosixProcesses(output: string): ProcessRow[] {
  return output.split('\n').flatMap((line) => {
    const [, pid, ppid, rss, command] = POSIX_ROW.exec(line) ?? []
    if (pid === undefined || ppid === undefined || rss === undefined) return []
    return [
      { pid: Number(pid), ppid: Number(ppid), rssBytes: Number(rss) * KIB, command: command ?? '' },
    ]
  })
}

export function listProcesses(platform: NodeJS.Platform = process.platform): ProcessRow[] {
  if (platform === 'win32') {
    const json = execFileSync('powershell.exe', ['-NoProfile', '-Command', WINDOWS_PROCESSES], {
      encoding: 'utf8',
      maxBuffer: EXEC_BUFFER_BYTES,
      windowsHide: true,
    })
    return parseWindowsProcesses(json)
  }
  const output = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,rss=,args='], {
    encoding: 'utf8',
    maxBuffer: EXEC_BUFFER_BYTES,
  })
  return parsePosixProcesses(output)
}

function comparable(value: string) {
  return value.replaceAll('\\', '/').toLowerCase()
}

/**
 * The app's processes: the roots (the launched process) and every process whose command line
 * names one of `installPaths`, each with its descendants. `excludePids` (the measuring script
 * itself) never count.
 */
export function selectAppProcesses(
  rows: readonly ProcessRow[],
  input: {
    readonly rootPids: readonly number[]
    readonly installPaths: readonly string[]
    readonly excludePids?: readonly number[]
  },
) {
  const excluded = new Set(input.excludePids ?? [])
  const needles = input.installPaths.map(comparable).filter((needle) => needle !== '')
  const children = new Map<number, number[]>()
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid])
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const named = rows.filter((row) =>
    needles.some((needle) => comparable(row.command).includes(needle)),
  )
  const pending = [...input.rootPids, ...named.map((row) => row.pid)]
  const seen = new Set<number>()
  while (pending.length > 0) {
    const pid = pending.pop()
    if (pid === undefined || seen.has(pid) || excluded.has(pid)) continue
    seen.add(pid)
    pending.push(...(children.get(pid) ?? []))
  }
  return [...seen].flatMap((pid) => {
    const row = byPid.get(pid)
    return row === undefined ? [] : [row]
  })
}

const CHROMIUM_TYPE = /--type=([\w-]+)/u
const UTILITY_SUB_TYPE = /--utility-sub-type=([\w.]+)/u

function chromiumRole(command: string): ProcessRole | null {
  const type = CHROMIUM_TYPE.exec(command)?.[1]
  if (type === undefined) return null
  if (type === 'renderer') return 'renderer'
  if (type === 'gpu-process') return 'gpu'
  if (type === 'crashpad-handler') return 'crashpad'
  if (type === 'zygote') return 'zygote'
  if (type !== 'utility') return 'utility'
  const subType = UTILITY_SUB_TYPE.exec(command)?.[1] ?? ''
  return subType.startsWith('network.') ? 'network' : 'utility'
}

const CLI_COMMANDS = /\s(?:run|host|hive|mcp|sessions)\s/u

/**
 * A coarse role per process. Chromium and CEF helpers carry `--type=`; the Session Host and the
 * embedding child are the app binary run with OpenWaggle's own arguments; WebKit's helpers are the
 * system webview; an AppImage's runtime launches the app. Any other process started from the
 * install is the app's main process (or a CLI command), and the rest are what the app started:
 * shells, git, MCP servers.
 */
export function processRole(command: string, installPaths: readonly string[]): ProcessRole {
  const chromium = chromiumRole(command)
  if (chromium !== null) return chromium
  if (command.includes('session-host-internal')) return 'session-host'
  if (command.includes('transformersPath')) return 'embedding'
  if (/WebKit(?:Web|Network)Process|msedgewebview2/u.test(command)) return 'webview'
  if (/crashpad_handler/u.test(command)) return 'crashpad'
  if (/\.AppImage(?:\s|$)/u.test(command)) return 'launcher'
  const fromInstall = installPaths
    .map(comparable)
    .some((needle) => needle !== '' && comparable(command).includes(needle))
  if (!fromInstall) return 'child'
  return CLI_COMMANDS.test(` ${command} `) ? 'cli' : 'main'
}

export function appMemory(rows: readonly ProcessRow[], installPaths: readonly string[]): AppMemory {
  const byRole: Partial<Record<ProcessRole, RoleTotal>> = {}
  const processes = rows.map((row) => {
    const role = processRole(row.command, installPaths)
    const total = byRole[role] ?? { count: 0, rssBytes: 0 }
    byRole[role] = { count: total.count + 1, rssBytes: total.rssBytes + row.rssBytes }
    return { pid: row.pid, role, rssBytes: row.rssBytes }
  })
  return {
    rssBytes: rows.reduce((sum, row) => sum + row.rssBytes, 0),
    processCount: rows.length,
    byRole,
    processes,
  }
}

/** One sample of the running app's memory. */
export function sampleAppMemory(input: {
  readonly rootPids: readonly number[]
  readonly installPaths: readonly string[]
}) {
  const rows = selectAppProcesses(listProcesses(), { ...input, excludePids: [process.pid] })
  return appMemory(rows, input.installPaths)
}
