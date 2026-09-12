import { constants as osConstants } from 'node:os'
import type * as NodePtyModule from 'node-pty'
import type {
  TerminalKernelProcessInfo,
  TerminalProcessIdentity,
} from './terminal-process-identity'
import { installTerminalWindowsTelemetry } from './terminal-windows-telemetry'

export type TerminalKernelProcessRead =
  | { readonly status: 'found'; readonly info: TerminalKernelProcessInfo }
  | { readonly status: 'absent' }
  | { readonly status: 'unavailable' }

export type TerminalIdentitySignalResult = 'signaled' | 'absent' | 'mismatch' | 'unavailable'

interface TerminalProcessKernelApi {
  readonly readMany: (pids: readonly number[]) => unknown
  readonly signal: ((pid: number, startedAt: string, signal: number) => unknown) | null
}

let installedApi: TerminalProcessKernelApi | null = null
export const MAX_KERNEL_PROCESS_INFOS_PER_SAMPLE = 512
const KERNEL_PROCESS_INFO_BATCH_SIZE = 32

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function nullableIdentity(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0)
}

function parseKernelProcessInfo(pid: number, value: unknown): TerminalKernelProcessInfo | null {
  if (value === null || typeof value !== 'object') return null
  const observedPid: unknown = Reflect.get(value, 'pid')
  const startedAt: unknown = Reflect.get(value, 'startedAt')
  const ppid: unknown = Reflect.get(value, 'ppid')
  const pgid: unknown = Reflect.get(value, 'pgid')
  const tpgid: unknown = Reflect.get(value, 'tpgid')
  const ttyIdentity: unknown = Reflect.get(value, 'ttyIdentity')
  const zombie: unknown = Reflect.get(value, 'zombie')
  const name: unknown = Reflect.get(value, 'name')
  if (
    observedPid !== pid ||
    !positiveInteger(observedPid) ||
    typeof startedAt !== 'string' ||
    startedAt.length === 0 ||
    !integer(ppid) ||
    ppid < 0 ||
    !integer(pgid) ||
    !integer(tpgid) ||
    !nullableIdentity(ttyIdentity) ||
    typeof zombie !== 'boolean' ||
    typeof name !== 'string' ||
    name.length === 0
  ) {
    return null
  }
  return { pid, startedAt, ppid, pgid, tpgid, ttyIdentity, zombie, name }
}

/** Install the already-loaded node-pty kernel API without defeating lazy native loading. */
export function installTerminalProcessKernelApi(pty: typeof NodePtyModule) {
  installTerminalWindowsTelemetry(pty)
  const native: unknown = Reflect.get(pty, 'native')
  if (native === null || typeof native !== 'object') {
    installedApi = null
    return
  }
  const readMany: unknown = Reflect.get(native, 'processInfos')
  const signal: unknown = Reflect.get(native, 'signalProcess')
  if (typeof readMany !== 'function') {
    installedApi = null
    return
  }
  installedApi = {
    readMany: (pids) => {
      const value: unknown = Reflect.apply(readMany, native, [pids])
      return value
    },
    signal:
      typeof signal === 'function'
        ? (pid, startedAt, signalNumber) => {
            const value: unknown = Reflect.apply(signal, native, [pid, startedAt, signalNumber])
            return value
          }
        : null,
  }
}

export function readTerminalKernelProcessInfo(pid: number): TerminalKernelProcessRead {
  const result = readTerminalKernelProcessInfos([pid])
  if (result === null) return { status: 'unavailable' }
  const info = result.get(pid)
  return info === undefined ? { status: 'absent' } : { status: 'found', info }
}

function addKernelProcessInfo(
  candidate: unknown,
  requestedPids: ReadonlySet<number>,
  infos: Map<number, TerminalKernelProcessInfo>,
) {
  const pid: unknown =
    candidate !== null && typeof candidate === 'object' ? Reflect.get(candidate, 'pid') : undefined
  if (!positiveInteger(pid) || !requestedPids.has(pid) || infos.has(pid)) return false
  const info = parseKernelProcessInfo(pid, candidate)
  if (info === null) return false
  infos.set(pid, info)
  return true
}

/** Bounded native batches; omitted PIDs are confirmed absent. */
export function readTerminalKernelProcessInfos(
  pids: readonly number[],
  deadline = Number.POSITIVE_INFINITY,
) {
  const uniquePids = [...new Set(pids)]
  if (uniquePids.length === 0) return new Map<number, TerminalKernelProcessInfo>()
  if (
    installedApi === null ||
    uniquePids.length > MAX_KERNEL_PROCESS_INFOS_PER_SAMPLE ||
    uniquePids.some((pid) => !positiveInteger(pid)) ||
    Date.now() >= deadline
  ) {
    return null
  }
  try {
    const infos = new Map<number, TerminalKernelProcessInfo>()
    const requestedPids = new Set(uniquePids)
    for (let offset = 0; offset < uniquePids.length; offset += KERNEL_PROCESS_INFO_BATCH_SIZE) {
      if (Date.now() >= deadline) return null
      const batch = uniquePids.slice(offset, offset + KERNEL_PROCESS_INFO_BATCH_SIZE)
      const value = installedApi.readMany(batch)
      if (!Array.isArray(value) || Date.now() >= deadline) return null
      for (const candidate of value) {
        if (!addKernelProcessInfo(candidate, requestedPids, infos)) return null
      }
    }
    return infos
  } catch {
    return null
  }
}

/**
 * Re-read every candidate after the complete bounded sample. A process is safe
 * to use in an ancestry chain only when the same kernel birth identity exists
 * in both passes; otherwise a parent recycled between native batches could
 * authorize an unrelated descendant.
 */
export function readStableTerminalKernelProcessInfos(
  pids: readonly number[],
  deadline = Number.POSITIVE_INFINITY,
) {
  const before = readTerminalKernelProcessInfos(pids, deadline)
  if (before === null) return null
  const after = readTerminalKernelProcessInfos(pids, deadline)
  if (after === null) return null

  const stable = new Map<number, TerminalKernelProcessInfo>()
  for (const [pid, info] of after) {
    if (before.get(pid)?.startedAt === info.startedAt) stable.set(pid, info)
  }
  return stable
}

/**
 * Signal through a native identity-bound primitive. Linux uses a retained
 * pidfd; Darwin re-reads the process identity and signals with an audit token.
 * Neither platform falls back to `kill(pid)` across the PID-reuse race.
 */
export function signalTerminalProcessIdentity(
  identity: TerminalProcessIdentity,
  signal: 'SIGKILL',
): TerminalIdentitySignalResult {
  if (!positiveInteger(identity.pid) || installedApi?.signal === null || installedApi === null) {
    return 'unavailable'
  }
  const signalNumber = osConstants.signals[signal]
  if (!positiveInteger(signalNumber)) return 'unavailable'
  try {
    const result = installedApi.signal(identity.pid, identity.startedAt, signalNumber)
    if (result === 1) return 'signaled'
    if (result === 0) return 'absent'
    if (result === -1) return 'mismatch'
    return 'unavailable'
  } catch {
    return 'unavailable'
  }
}

/** Test-only reset; production installs exactly once with the lazy node-pty module. */
export function resetTerminalProcessKernelApiForTests() {
  installedApi = null
}
