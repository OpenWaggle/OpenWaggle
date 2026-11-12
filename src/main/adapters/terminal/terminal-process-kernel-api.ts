import { constants as osConstants } from 'node:os'
import type * as NodePtyModule from 'node-pty'
import type {
  TerminalKernelProcessInfo,
  TerminalProcessIdentity,
} from './terminal-process-identity'
import { installTerminalWindowsTelemetry } from './terminal-windows-telemetry'
import { terminalBackendModule, type TerminalBackendNative } from './terminal-pty-backend-fields'
import { uncheckedFields } from '@shared/utils/object-shape'

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

function parseKernelProcessInfo(pid: number, value: unknown) {
  const {
    pid: observedPid,
    startedAt,
    ppid,
    pgid,
    tpgid,
    ttyIdentity,
    zombie,
    name,
  } = uncheckedFields<TerminalKernelProcessInfo>(value)
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
  const info: TerminalKernelProcessInfo | null = {
    pid,
    startedAt,
    ppid,
    pgid,
    tpgid,
    ttyIdentity,
    zombie,
    name,
  }
  return info
}

/** Install the already-loaded node-pty kernel API without defeating lazy native loading. */
export function installTerminalProcessKernelApi(pty: typeof NodePtyModule) {
  installTerminalWindowsTelemetry(pty)
  const native: unknown = terminalBackendModule(pty).native
  const nativeFields = uncheckedFields<TerminalBackendNative>(native)
  if (native === null || typeof native !== 'object') {
    installedApi = null
    return
  }
  const readMany: unknown = nativeFields.processInfos
  const signal: unknown = nativeFields.signalProcess
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

export function readTerminalKernelProcessInfo(pid: number) {
  const result = readTerminalKernelProcessInfos([pid])
  if (result === null) {
    const read: TerminalKernelProcessRead = { status: 'unavailable' }
    return read
  }
  const info = result.get(pid)
  const read: TerminalKernelProcessRead =
    info === undefined ? { status: 'absent' } : { status: 'found', info }
  return read
}

function addKernelProcessInfo(
  candidate: unknown,
  requestedPids: ReadonlySet<number>,
  infos: Map<number, TerminalKernelProcessInfo>,
) {
  const { pid } = uncheckedFields<TerminalKernelProcessInfo>(candidate)
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
) {
  if (!positiveInteger(identity.pid) || installedApi?.signal === null || installedApi === null) {
    const value: TerminalIdentitySignalResult = 'unavailable'
    return value
  }
  const signalNumber = osConstants.signals[signal]
  if (!positiveInteger(signalNumber)) {
    const value: TerminalIdentitySignalResult = 'unavailable'
    return value
  }
  try {
    const result = installedApi.signal(identity.pid, identity.startedAt, signalNumber)
    if (result === 1) {
      const value: TerminalIdentitySignalResult = 'signaled'
      return value
    }
    if (result === 0) {
      const value: TerminalIdentitySignalResult = 'absent'
      return value
    }
    if (result === -1) {
      const value: TerminalIdentitySignalResult = 'mismatch'
      return value
    }
    const value: TerminalIdentitySignalResult = 'unavailable'
    return value
  } catch {
    const value: TerminalIdentitySignalResult = 'unavailable'
    return value
  }
}

/** Test-only reset; production installs exactly once with the lazy node-pty module. */
export function resetTerminalProcessKernelApiForTests() {
  installedApi = null
}
