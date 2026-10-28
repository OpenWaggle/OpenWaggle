import { execFileSync } from 'node:child_process'
import path from 'node:path'

interface ProcessRow {
  readonly pid: number
  readonly ppid: number
  readonly command: string
}

export interface ProcessSample {
  readonly footprint: number
  readonly resident: number
  readonly cpuNs: number
  readonly wakeups: number
}

const PS_MAX_BUFFER = 64 * 1024 * 1024
const FOOTPRINT_SCRIPT = path.join(import.meta.dirname, 'process-footprint.py')
const PID_COLUMN = 0
const PPID_COLUMN = 1
const COMMAND_START_COLUMN = 2
const APP_BUNDLE_SUFFIX = '.app/'
const PRIVATE_PREFIX = '/private/'

function listProcesses(withEnvironment: boolean): ProcessRow[] {
  const output = execFileSync(
    '/bin/ps',
    [withEnvironment ? '-axwwE' : '-axww', '-o', 'pid=,ppid=,command='],
    { encoding: 'utf8', maxBuffer: PS_MAX_BUFFER },
  )
  return output.split('\n').flatMap((line) => {
    const columns = line.trim().split(/\s+/)
    const pid = Number(columns[PID_COLUMN])
    const ppid = Number(columns[PPID_COLUMN])
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) return []
    return [{ pid, ppid, command: columns.slice(COMMAND_START_COLUMN).join(' ') }]
  })
}

/** The Session Host of one throwaway profile, found by the user-data path in its environment. */
export function profileHostPids(userData: string) {
  const marker = `OPENWAGGLE_USER_DATA_DIR=${userData} `
  return listProcesses(true)
    .filter((row) => row.command.includes('session-host-internal') && `${row.command} `.includes(marker))
    .map((row) => row.pid)
}

/** The processes and every descendant: helpers, MCP servers and their `npm exec` wrappers. */
export function processTree(rootPids: readonly number[]) {
  const rows = listProcesses(false)
  const children = new Map<number, number[]>()
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid])
  const commands = new Map(rows.map((row) => [row.pid, row.command]))
  const seen = new Set<number>()
  const pending = [...rootPids]
  while (pending.length > 0) {
    const pid = pending.pop()
    if (pid === undefined || seen.has(pid)) continue
    seen.add(pid)
    pending.push(...(children.get(pid) ?? []))
  }
  return [...seen].map((pid) => ({ pid, command: commands.get(pid) ?? '' }))
}

function isProcessSample(value: unknown): value is ProcessSample {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'footprint') === 'number' &&
    typeof Reflect.get(value, 'cpuNs') === 'number'
  )
}

/** Physical footprint, resident size and CPU time per pid (macOS `proc_pid_rusage`). */
export function sampleProcesses(pids: readonly number[]): Map<number, ProcessSample> {
  if (pids.length === 0) return new Map()
  const output = execFileSync('python3', [FOOTPRINT_SCRIPT, ...pids.map(String)], { encoding: 'utf8' })
  const parsed: unknown = JSON.parse(output)
  const samples = new Map<number, ProcessSample>()
  if (typeof parsed !== 'object' || parsed === null) return samples
  for (const [pid, value] of Object.entries(parsed)) {
    if (isProcessSample(value)) samples.set(Number(pid), value)
  }
  return samples
}

/** The `.app` bundle an executable belongs to, or its directory for a development Electron. */
export function appBundleOf(executable: string) {
  const end = executable.indexOf(APP_BUNDLE_SUFFIX)
  return end < 0 ? path.dirname(executable) : executable.slice(0, end + APP_BUNDLE_SUFFIX.length - 1)
}

function withoutPrivatePrefix(value: string) {
  return value.startsWith(PRIVATE_PREFIX) ? value.slice(PRIVATE_PREFIX.length - 1) : value
}

/**
 * A coarse role for each process of an OpenWaggle tree, for per-role memory totals. App processes
 * are the ones whose executable lies inside the measured app bundle (`/tmp` and `/private/tmp` are
 * one path on macOS); anything else in the tree is an MCP server or its `npm exec` wrapper, even
 * when its own path happens to contain "OpenWaggle". The Host's transient embedding child (the app
 * executable run as Node with the transformers.js path) is counted as the Host's.
 */
export function processRole(command: string, appBundle: string) {
  const fromApp = withoutPrivatePrefix(command).startsWith(`${withoutPrivatePrefix(appBundle)}/`)
  if (!fromApp) return /\bnpm exec\b|\bnpx\b/.test(command) ? 'mcp-npm-wrapper' : 'mcp-server'
  if (command.includes('session-host-internal')) return 'host'
  if (command.includes('transformersPath')) return 'host-embedding'
  if (command.includes('--type=renderer')) return 'renderer'
  if (command.includes('--type=gpu-process')) return 'gpu'
  if (command.includes('--type=utility')) return 'utility'
  return 'gui-main'
}
