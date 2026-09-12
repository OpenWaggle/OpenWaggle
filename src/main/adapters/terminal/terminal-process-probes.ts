import os from 'node:os'
import {
  runTerminalProcessCommand as runCommand,
  type TerminalProcessCommandResult,
} from './terminal-process-command'
import {
  TERMINAL_SPAWN_PROCESS_METADATA_MS,
  type TerminalProcessIdentity,
  type TerminalProcessMetadata,
} from './terminal-process-identity'
import {
  readStableTerminalKernelProcessInfos,
  readTerminalKernelProcessInfo,
  type TerminalKernelProcessRead,
} from './terminal-process-kernel-api'
import { readWindowsTerminalProcesses } from './terminal-windows-telemetry'

export { readListeningPorts } from './terminal-process-ports'

const POSIX_PROCESS_START_COLUMN = 6
const POSIX_PROCESS_PREFIX_COLUMNS = 11
const POSIX_PROCESS_METADATA_COLUMNS = 6
const PGREP_UNKNOWN_TTY_EXIT_CODE = 2
const PROCESS_TTY_CAPTURE_DELAYS_MS = [25, 50, 100]
const POSIX_PS_COMMAND = process.platform === 'darwin' ? '/bin/ps' : 'ps'
const POSIX_PGREP_COMMAND = process.platform === 'darwin' ? '/usr/bin/pgrep' : 'pgrep'
export const NO_TTY_FOREGROUND_GROUP = -1

export interface ProcessTableTarget {
  readonly rootPid: number
  readonly cachedPids: readonly number[]
  readonly tty: string | null
  readonly ttyClosed: boolean
}

export interface ProcessProbeOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export interface ProcessRow extends TerminalProcessIdentity {
  readonly pid: number
  readonly ppid: number
  /** Process group id; POSIX only (-1 on Windows rows). */
  readonly pgid: number
  /** Controlling tty's foreground process group; POSIX only (-1 elsewhere). */
  readonly tpgid: number
  /** Controlling tty name without the /dev prefix; null when unavailable. */
  readonly tty: string | null
  /** Kernel device identity for the tty; text names never authorize ownership. */
  readonly ttyIdentity: string | null
  /** True only when identity and ancestry came from one kernel-coherent read. */
  readonly identityVerified: boolean
  /** POSIX process state starts with Z while the exited process awaits reaping. */
  readonly zombie: boolean
  readonly name: string
}

export async function readProcessTable(
  target?: ProcessTableTarget,
  options: ProcessProbeOptions = {},
) {
  if (options.signal?.aborted) return null
  if (os.platform() === 'win32') return readWindowsTerminalProcesses(options)
  if (target !== undefined && (target.ttyClosed || (target.tty !== null && target.tty !== '??'))) {
    return readPosixTerminalTty(target, options)
  }
  const result = await runCommand(
    POSIX_PS_COMMAND,
    ['-eo', 'pid=,ppid=,pgid=,tpgid=,tty=,stat=,lstart=,comm='],
    options.timeoutMs,
    options.signal,
  )
  if (options.signal?.aborted) return null
  if (!result.ok) return null
  const rows = parsePosixProcessTable(result.output)
  return rows.size === 0 ? null : rows
}

async function readProcessTtyOnce(pid: number) {
  return (await readProcessMetadata(pid))?.tty ?? null
}

/** Spawn-bound fallback when node-pty does not expose its private device path. */
export async function readProcessTty(pid: number, shouldContinue: () => boolean = () => true) {
  if (os.platform() === 'win32') return null
  for (const delayMs of PROCESS_TTY_CAPTURE_DELAYS_MS) {
    if (!shouldContinue()) return null
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
    if (!shouldContinue()) return null
    const tty = await readProcessTtyOnce(pid)
    if (tty !== null) return tty
  }
  return null
}

/** One bounded, targeted spawn-time sample. Never scans the global process table. */
export async function readProcessMetadata(
  pid: number,
  timeoutMs = TERMINAL_SPAWN_PROCESS_METADATA_MS,
  expectedStartedAt?: string,
  expectedTtyIdentity?: string,
): Promise<TerminalProcessMetadata | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null
  // ConPTY is closed through its native handle, not a numeric root PID. Avoid
  // starting a cold PowerShell process for metadata that POSIX alone needs.
  if (os.platform() === 'win32') return null
  const deadline = Date.now() + timeoutMs
  const before = readTerminalKernelProcessInfo(pid)
  if (!matchesExpectedProcess(before, expectedStartedAt, expectedTtyIdentity)) return null
  const remaining = deadline - Date.now()
  if (remaining <= 0) return null
  const result = await runCommand(POSIX_PS_COMMAND, ['-o', 'tty=', '-p', String(pid)], remaining)
  if (!result.ok) return null
  const tty = parsePosixTty(result.output)
  if (tty === undefined) return null
  if (Date.now() >= deadline) return null
  const after = readTerminalKernelProcessInfo(pid)
  if (
    after.status !== 'found' ||
    after.info.startedAt !== before.info.startedAt ||
    after.info.ttyIdentity !== before.info.ttyIdentity
  ) {
    return null
  }
  return {
    pid,
    startedAt: after.info.startedAt,
    tty,
    ttyIdentity: after.info.ttyIdentity,
  }
}

function matchesExpectedProcess(
  processInfo: TerminalKernelProcessRead,
  expectedStartedAt: string | undefined,
  expectedTtyIdentity: string | undefined,
): processInfo is Extract<TerminalKernelProcessRead, { readonly status: 'found' }> {
  return (
    processInfo.status === 'found' &&
    (expectedStartedAt === undefined || processInfo.info.startedAt === expectedStartedAt) &&
    (expectedTtyIdentity === undefined || processInfo.info.ttyIdentity === expectedTtyIdentity)
  )
}

export function parsePosixProcessMetadataRow(
  pid: number,
  output: string,
): TerminalProcessMetadata | null {
  const columns = output.trim().split(/\s+/)
  if (columns.length !== POSIX_PROCESS_METADATA_COLUMNS) return null
  const [ttyField, ...startedAtFields] = columns
  const startedAt = startedAtFields.join(' ')
  if (ttyField === undefined || startedAt.length === 0) return null
  return { pid, startedAt, tty: normalizeTty(ttyField), ttyIdentity: null }
}

function parsePosixTty(output: string) {
  const trimmed = output.trim()
  if (trimmed.length === 0) return undefined
  const columns = trimmed.split(/\s+/)
  if (columns.length !== 1 || columns[0] === undefined) return undefined
  return normalizeTty(columns[0])
}

/** Replace discovery-only `ps` rows with coherent kernel identity/ancestry. */
export function hydratePosixProcessRows(
  rows: ReadonlyMap<number, ProcessRow>,
  pids: Iterable<number>,
  deadline = Number.POSITIVE_INFINITY,
) {
  if (os.platform() === 'win32') return new Map(rows)
  const hydrated = new Map(rows)
  const candidates = [...new Set(pids)]
  const observed = readStableTerminalKernelProcessInfos(candidates, deadline)
  if (observed === null) return null
  for (const pid of candidates) {
    const row = hydrated.get(pid)
    const info = observed.get(pid)
    if (info === undefined) {
      hydrated.delete(pid)
      continue
    }
    hydrated.set(pid, {
      pid,
      ppid: info.ppid,
      pgid: info.pgid,
      tpgid: info.tpgid,
      tty: row?.tty ?? null,
      ttyIdentity: info.ttyIdentity,
      identityVerified: true,
      zombie: info.zombie,
      startedAt: info.startedAt,
      name: basename(info.name),
    })
  }
  return hydrated
}

function terminalSessionIsUsable(session: TerminalProcessCommandResult) {
  if (session.ok || session.exitCode === 1) return true
  return (
    session.exitCode === PGREP_UNKNOWN_TTY_EXIT_CODE &&
    session.errorOutput.toLowerCase().includes('no such tty')
  )
}

function terminalProcessPids(target: ProcessTableTarget, output: string) {
  const processPids = new Set(target.cachedPids)
  processPids.add(target.rootPid)
  for (const field of output.split(/\s+/)) {
    const pid = Number(field)
    if (Number.isInteger(pid) && pid > 0) processPids.add(pid)
  }
  return [...processPids]
}

function emptyTerminalSession(): TerminalProcessCommandResult {
  return { ok: true, output: '', errorOutput: '', exitCode: null }
}

async function readPosixTerminalTty(target: ProcessTableTarget, options: ProcessProbeOptions) {
  const deadline =
    options.timeoutMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.timeoutMs
  // One tty query finds foreground jobs, background jobs, and reparented
  // session members without walking every process on the desktop. Cached pids
  // retain descendants that deliberately detached from the controlling tty.
  const session = target.ttyClosed
    ? emptyTerminalSession()
    : await runCommand(
        POSIX_PGREP_COMMAND,
        ['-t', target.tty ?? ''],
        options.timeoutMs,
        options.signal,
      )
  if (options.signal?.aborted) return null
  if (!terminalSessionIsUsable(session)) return null
  const processPids = terminalProcessPids(target, session.output)
  const result = await runCommand(
    POSIX_PS_COMMAND,
    ['-o', 'pid=,ppid=,pgid=,tpgid=,tty=,stat=,lstart=,comm=', '-p', processPids.join(',')],
    options.timeoutMs,
    options.signal,
  )
  if (options.signal?.aborted) return null
  if (!result.ok && result.exitCode !== 1) return null
  const rows = parsePosixProcessTable(result.output)
  if (rows.size === 0 && result.output.trim().length > 0) return null
  return hydratePosixProcessRows(rows, processPids, deadline)
}

function parsePosixProcessTable(output: string) {
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
  if (columns.length < POSIX_PROCESS_PREFIX_COLUMNS + 1) return null
  const [pidField, ppidField, pgidField, tpgidField, ttyField, stateField] = columns
  const startedAt = columns
    .slice(POSIX_PROCESS_START_COLUMN, POSIX_PROCESS_PREFIX_COLUMNS)
    .join(' ')
  const name = columns.slice(POSIX_PROCESS_PREFIX_COLUMNS).join(' ')
  const pid = Number(pidField)
  const ppid = Number(ppidField)
  const pgid = Number(pgidField)
  const tpgid = Number(tpgidField)
  if (
    ![pid, ppid, pgid, tpgid].every(Number.isInteger) ||
    startedAt.length === 0 ||
    name.length === 0
  ) {
    return null
  }
  return {
    pid,
    ppid,
    pgid,
    tpgid,
    tty: normalizeTty(ttyField),
    ttyIdentity: null,
    identityVerified: false,
    zombie: stateField?.startsWith('Z') ?? false,
    startedAt,
    name: basename(name),
  }
}

function basename(command: string) {
  const normalized = command.replaceAll('\\', '/')
  const lastSegment = normalized.split('/').pop() ?? command
  return lastSegment.replace(/\.(exe|cmd|bat)$/i, '')
}

function normalizeTty(tty: string | undefined) {
  return tty === undefined || tty === '?' || tty === '??' ? null : tty
}
