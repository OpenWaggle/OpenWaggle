import { collectDescendants } from './terminal-process-activity'
import type { TerminalProcessIdentity } from './terminal-process-identity'
import { readTerminalKernelProcessInfo } from './terminal-process-kernel-api'
import { type ProcessRow, readProcessTable } from './terminal-process-probes'
import {
  matchesCachedProcessIdentity,
  terminalRootIdentityProof,
} from './terminal-process-root-identity'

// A full macOS process table usually takes about 50 ms in a large desktop
// process tree but can be descheduled for longer. Each post-signal snapshot is
// clipped to the shutdown phase's remaining overall deadline.
export const TERMINAL_PROCESS_SNAPSHOT_MS = 225

export interface TerminalProcessPidRefresh {
  readonly processPids: readonly number[]
  readonly processIdentities: readonly TerminalProcessIdentity[]
  /** Validated processes still attached to the exact controlling tty. */
  readonly ttyProcessPids: readonly number[]
  readonly unverifiedProcessPids: readonly number[]
  readonly zombiePids: readonly number[]
  readonly observedProcesses: readonly {
    readonly pid: number
    readonly ppid: number
    readonly name: string
    readonly zombie: boolean
    readonly startedAt: string
  }[]
  readonly reliable: boolean
  readonly rootIdentityVerified: boolean
  readonly rootIdentityMismatch: boolean
  /** The spawn lifetime is absent even if its numeric PID has been reused. */
  readonly rootExitedByIdentity: boolean
}

type ProcessRows = ReadonlyMap<number, ProcessRow>

function unavailableRefresh(cachedPids: readonly number[]): TerminalProcessPidRefresh {
  return {
    processPids: [],
    processIdentities: [],
    ttyProcessPids: [],
    unverifiedProcessPids: cachedPids,
    zombiePids: [],
    observedProcesses: [],
    reliable: false,
    rootIdentityVerified: false,
    rootIdentityMismatch: false,
    rootExitedByIdentity: false,
  }
}

function isMissingProcessError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}

function isProcessAbsent(pid: number) {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return isMissingProcessError(error)
  }
}

function closedTtyHasNoKnownProcesses(
  rootPid: number,
  cachedPids: readonly number[],
  cachedIdentities: readonly TerminalProcessIdentity[],
  ttyClosed: boolean,
) {
  if (process.platform === 'win32' || !ttyClosed) return false
  const identitiesByPid = new Map(cachedIdentities.map((identity) => [identity.pid, identity]))
  for (const identity of identitiesByPid.values()) {
    const current = readTerminalKernelProcessInfo(identity.pid)
    if (current.status === 'unavailable') {
      if (isProcessAbsent(identity.pid)) continue
      return false
    }
    if (current.status === 'found' && current.info.startedAt === identity.startedAt) return false
  }
  const knownPids = new Set([rootPid, ...cachedPids])
  for (const identity of cachedIdentities) knownPids.delete(identity.pid)
  return [...knownPids].every(isProcessAbsent)
}

function emptyReliableRefresh(): TerminalProcessPidRefresh {
  return {
    processPids: [],
    processIdentities: [],
    ttyProcessPids: [],
    unverifiedProcessPids: [],
    zombiePids: [],
    observedProcesses: [],
    reliable: true,
    rootIdentityVerified: false,
    rootIdentityMismatch: false,
    rootExitedByIdentity: true,
  }
}

function collectValidatedPids(input: {
  readonly rootPid: number
  readonly rootIdentityVerified: boolean
  readonly rootDescendants: ReadonlySet<number>
  readonly rows: ProcessRows
  readonly cachedByPid: ReadonlyMap<number, TerminalProcessIdentity>
  readonly ttyIdentity: string | null
  readonly ttyMembershipClosed: boolean
}) {
  const processPids = new Set<number>()
  if (input.rootIdentityVerified) {
    for (const pid of input.rootDescendants) processPids.add(pid)
  }
  for (const identity of input.cachedByPid.values()) {
    const row = input.rows.get(identity.pid)
    if (matchesCachedProcessIdentity(row, identity)) {
      processPids.add(identity.pid)
    }
  }
  if (!input.ttyMembershipClosed && input.ttyIdentity !== null) {
    for (const row of input.rows.values()) {
      const rootIsSafe = row.pid !== input.rootPid || input.rootIdentityVerified
      const cached = input.cachedByPid.get(row.pid)
      const identityIsSafe = cached === undefined || cached.startedAt === row.startedAt
      if (
        row.identityVerified &&
        row.ttyIdentity === input.ttyIdentity &&
        rootIsSafe &&
        identityIsSafe
      ) {
        processPids.add(row.pid)
      }
    }
  }
  return processPids
}

function collectUnverifiedPids(input: {
  readonly rootPid: number
  readonly rootIdentityVerified: boolean
  readonly rootDescendants: ReadonlySet<number>
  readonly rows: ProcessRows
  readonly cachedPids: readonly number[]
  readonly cachedByPid: ReadonlyMap<number, TerminalProcessIdentity>
  readonly processPids: ReadonlySet<number>
}) {
  const unverified = new Set<number>()
  for (const pid of input.cachedPids) {
    const isUnidentifiedLiveChild =
      pid !== input.rootPid &&
      input.rows.has(pid) &&
      !input.cachedByPid.has(pid) &&
      !input.processPids.has(pid)
    if (isUnidentifiedLiveChild) unverified.add(pid)
  }
  return unverified
}

function collectValidatedIdentities(
  processPids: ReadonlySet<number>,
  rows: ProcessRows,
  cachedByPid: ReadonlyMap<number, TerminalProcessIdentity>,
) {
  const identities: TerminalProcessIdentity[] = []
  for (const pid of processPids) {
    const row = rows.get(pid)
    if (row?.identityVerified !== true) continue
    const cached = cachedByPid.get(pid)
    if (cached !== undefined && cached.startedAt !== row.startedAt) continue
    identities.push({ pid: row.pid, startedAt: row.startedAt })
  }
  return identities
}

function collectObservedProcesses(
  processPids: ReadonlySet<number>,
  unverifiedPids: ReadonlySet<number>,
  rootPid: number,
  rootIdentityMismatch: boolean,
  rows: ProcessRows,
) {
  const observedPids = new Set([...processPids, ...unverifiedPids])
  if (rootIdentityMismatch) observedPids.add(rootPid)
  const observed = []
  for (const pid of observedPids) {
    const row = rows.get(pid)
    if (row === undefined) continue
    observed.push({
      pid: row.pid,
      ppid: row.ppid,
      name: row.name,
      zombie: row.zombie,
      startedAt: row.startedAt,
    })
  }
  return observed
}

/**
 * Add a fresh process-table observation to the terminal's pid set. Earlier
 * descendants stay tracked while they remain present even after reparenting;
 * exited pids are pruned so later pid reuse cannot target another process.
 */
export async function refreshTerminalProcessPids(
  rootPid: number,
  cachedPids: readonly number[],
  cachedIdentities: readonly TerminalProcessIdentity[],
  tty: string | null,
  ttyIdentity: string | null,
  ttyClosed: boolean,
  timeoutMs = TERMINAL_PROCESS_SNAPSHOT_MS,
  ttyMembershipClosed = ttyClosed,
): Promise<TerminalProcessPidRefresh> {
  // Once the exact PTY has reported exit and its tty device has disappeared,
  // a missing numeric PID is a complete absence proof. This fast path never
  // authorizes a signal: a live or recycled PID falls through to the
  // birth-identity process-table probe. It also avoids making successful
  // shutdown depend on launching `ps` while the host is under output load.
  if (closedTtyHasNoKnownProcesses(rootPid, cachedPids, cachedIdentities, ttyClosed)) {
    return emptyReliableRefresh()
  }
  let timeout: NodeJS.Timeout | null = null
  const abort = new AbortController()
  const timedOut = new Promise<null>((resolve) => {
    timeout = setTimeout(() => {
      abort.abort()
      resolve(null)
    }, timeoutMs)
  })
  const table = readProcessTable(
    // Once descriptor closure is requested, keep validating already-known
    // identities and ancestry but never adopt a newly observed tty member.
    // The textual tty/device identity may be reused before physical closure is
    // observable; only `ttyClosed` is allowed to enable absence fast paths.
    { rootPid, cachedPids, tty, ttyClosed: ttyMembershipClosed },
    { signal: abort.signal, timeoutMs },
  )
  const rows = await Promise.race([table, timedOut])
  if (timeout !== null) clearTimeout(timeout)
  if (rows === null) return unavailableRefresh(cachedPids)

  const cachedByPid = new Map(cachedIdentities.map((identity) => [identity.pid, identity]))
  const root = rows.get(rootPid)
  const cachedRoot = cachedByPid.get(rootPid)
  const rootDescendants =
    root === undefined ? new Set<number>() : collectDescendants(rootPid, rows).pids
  const { rootIdentityVerified, rootIdentityMismatch, rootExitedByIdentity } =
    terminalRootIdentityProof(root, cachedRoot, ttyClosed, ttyIdentity)
  const processPids = collectValidatedPids({
    rootPid,
    rootIdentityVerified,
    rootDescendants,
    rows,
    cachedByPid,
    ttyIdentity,
    ttyMembershipClosed,
  })
  // A child can be reparented between the PTY exit event and this snapshot.
  // Every process still attached to this terminal belongs to the terminal's
  // isolated tty even when the root/child PPID edge has already disappeared.
  // A PTY exit can race the first inspector sample. If that root pid has
  // already been recycled, following its fresh PPID edges would adopt and
  // signal an unrelated tree. Exact cached birth identities and membership in
  // the still-open controlling tty are independent proof; any remaining
  // PPID-only descendant makes this snapshot unsafe for exit confirmation.
  const unverifiedProcessPids = collectUnverifiedPids({
    rootPid,
    rootIdentityVerified,
    rootDescendants,
    rows,
    cachedPids,
    cachedByPid,
    processPids,
  })
  const zombiePids = [...processPids].filter((pid) => rows.get(pid)?.zombie === true)
  const processIdentities = collectValidatedIdentities(processPids, rows, cachedByPid)
  const ttyProcessPids =
    ttyIdentity === null
      ? []
      : [...processPids].filter((pid) => rows.get(pid)?.ttyIdentity === ttyIdentity)
  const observedProcesses = collectObservedProcesses(
    processPids,
    unverifiedProcessPids,
    rootPid,
    rootIdentityMismatch,
    rows,
  )
  return {
    processPids: [...processPids],
    processIdentities,
    ttyProcessPids,
    unverifiedProcessPids: [...unverifiedProcessPids],
    zombiePids,
    observedProcesses,
    reliable: cachedRoot !== undefined && unverifiedProcessPids.size === 0,
    rootIdentityVerified,
    rootIdentityMismatch,
    rootExitedByIdentity,
  }
}
