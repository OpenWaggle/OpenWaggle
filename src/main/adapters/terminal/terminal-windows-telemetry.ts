import { isMatching, P } from '@diegogbrisa/ts-match'
import type * as NodePtyModule from 'node-pty'
import type { ProcessProbeOptions, ProcessRow } from './terminal-process-probes'

const MAX_TELEMETRY_ROWS = 16_384
const TELEMETRY_TIMEOUT_MS = 1_500
const MAX_TCP_PORT = 65_535
const NO_PROCESS_GROUP = -1
type NativeQuery = () => unknown

function isQuery(value: unknown): value is NativeQuery {
  return typeof value === 'function'
}

/** A timed-out caller cannot enqueue another native worker while the first is still running. */
function singleFlight(query: NativeQuery): NativeQuery {
  let pending: Promise<unknown> | null = null
  return () => {
    pending ??= Promise.resolve()
      .then(query)
      .finally(() => {
        pending = null
      })
    return pending
  }
}

let processes: NativeQuery | null = null
let listeners: NativeQuery | null = null

export function installTerminalWindowsTelemetry(pty: typeof NodePtyModule) {
  const processQuery: unknown = Reflect.get(pty, 'processTable')
  const listenerQuery: unknown = Reflect.get(pty, 'listeningPorts')
  processes = isQuery(processQuery)
    ? singleFlight(() => Reflect.apply(processQuery, pty, []))
    : null
  listeners = isQuery(listenerQuery)
    ? singleFlight(() => Reflect.apply(listenerQuery, pty, []))
    : null
}

async function queryWithinDeadline(query: NativeQuery | null, options: ProcessProbeOptions = {}) {
  if (
    query === null ||
    options.signal?.aborted ||
    (options.timeoutMs !== undefined && options.timeoutMs <= 0)
  )
    return null
  return new Promise<unknown>((resolve) => {
    const finish = (value: unknown) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      resolve(value)
    }
    const abort = () => finish(null)
    const timer = setTimeout(
      abort,
      Math.min(options.timeoutMs ?? TELEMETRY_TIMEOUT_MS, TELEMETRY_TIMEOUT_MS),
    )
    options.signal?.addEventListener('abort', abort, { once: true })
    void Promise.resolve().then(query).then(finish, abort)
  })
}

function boundedRows(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= MAX_TELEMETRY_ROWS
}

const positiveId = P.when(
  (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0,
)
const parentId = P.when(
  (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
)

export async function readWindowsTerminalProcesses(options: ProcessProbeOptions = {}) {
  const value = await queryWithinDeadline(processes, options)
  if (!boundedRows(value)) return null
  const rows = new Map<number, ProcessRow>()
  for (const candidate of value) {
    if (
      !isMatching(
        { pid: positiveId, ppid: parentId, startedAt: P.regex(/^[1-9]\d{0,19}$/), name: P.string },
        candidate,
      )
    )
      return null
    if (rows.has(candidate.pid) || candidate.name.length === 0) return null
    rows.set(candidate.pid, {
      pid: candidate.pid,
      ppid: candidate.ppid,
      startedAt: candidate.startedAt,
      pgid: NO_PROCESS_GROUP,
      tpgid: NO_PROCESS_GROUP,
      tty: null,
      ttyIdentity: null,
      // Toolhelp is discovery metadata, not coherent kernel ownership evidence.
      identityVerified: false,
      zombie: false,
      name: candidate.name.replace(/\.(exe|cmd|bat)$/i, ''),
    })
  }
  // A reused parent PID cannot make an older process a child of a newer shell.
  for (const [pid, row] of rows) {
    const parent = rows.get(row.ppid)
    if (parent && BigInt(parent.startedAt) > BigInt(row.startedAt))
      rows.set(pid, { ...row, ppid: 0 })
  }
  return rows
}

export async function readWindowsTerminalListeners() {
  const value = await queryWithinDeadline(listeners)
  if (!boundedRows(value)) return null
  const rows: { readonly pid: number; readonly port: number; readonly host: string }[] = []
  for (const candidate of value) {
    if (!isMatching({ pid: positiveId, port: positiveId, host: P.string }, candidate)) return null
    if (candidate.port > MAX_TCP_PORT || candidate.host.length === 0) return null
    rows.push({ pid: candidate.pid, port: candidate.port, host: candidate.host })
  }
  return rows
}
