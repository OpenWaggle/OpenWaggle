import type { PtyKernel } from '../terminal-pty-backend'
import { type PlatformKernel, SIGNAL_RESULT, type SignalResult } from './posix-kernel-types'

/**
 * Process identity for the terminal runtime on macOS and Linux (ADR 0030), through `bun:ffi`
 * and `/proc` (`posix-kernel-darwin.ts`, `posix-kernel-linux.ts`), as the patched node-pty addon
 * did natively.
 *
 * The PTY master has no descriptor in JavaScript under `Bun.Terminal`, so `signalByTty` takes
 * the backend's handle for a live terminal (`registerTerminalHandle`) and refuses once that
 * terminal is closed, where the addon checked its master descriptor.
 */
const MAX_PIDS_PER_CALL = 32
/** `signalByTty` could not prove the terminal's identity, or failed before signaling anything. */
const TTY_UNPROVEN = -1
/** `signalByTty` failed after signaling some members. */
const TTY_PARTIAL = -2

/** The kernel primitives plus the tty path the runtime shows and probes with. */
export interface PosixKernel extends PtyKernel {
  readonly ttyPath: (pid: number) => string | null
}

/** Live terminals by handle: the tty identity each one's master is bound to. */
const terminalHandles = new Map<number, () => string | null>()
let nextTerminalHandle = 1

/**
 * Registers a live terminal for `signalByTty`; `ttyIdentity` answers null once its master is
 * closed. Returns the handle the runtime passes back (node-pty's `fd`).
 */
export function registerTerminalHandle(ttyIdentity: () => string | null) {
  const handle = nextTerminalHandle
  nextTerminalHandle += 1
  terminalHandles.set(handle, ttyIdentity)
  return handle
}

export function releaseTerminalHandle(handle: number) {
  terminalHandles.delete(handle)
}

function assertPids(pids: readonly number[]) {
  if (pids.length > MAX_PIDS_PER_CALL) throw new RangeError('processInfos accepts at most 32 PIDs.')
  if (
    new Set(pids).size !== pids.length ||
    pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)
  ) {
    throw new TypeError('processInfos accepts unique positive integers.')
  }
}

interface TtySignalRequest {
  readonly ttyIdentity: string
  readonly rootPid: number
  readonly rootIdentity: string
  readonly signal: number
  readonly ownUid: number
}

/** Counts a signal; a failure is reported as the addon did, by how far it got. */
class TtySignalTally {
  signaled = 0
  failed = false

  record(result: SignalResult) {
    if (result === SIGNAL_RESULT.signaled) this.signaled += 1
    if (result === SIGNAL_RESULT.failed) this.failed = true
    return !this.failed
  }

  result() {
    if (!this.failed) return this.signaled
    return this.signaled === 0 ? TTY_UNPROVEN : TTY_PARTIAL
  }
}

/** The root is either gone, or still the same process on the same tty and owned by this user. */
function rootIsProven(platform: PlatformKernel, request: TtySignalRequest) {
  const root = platform.read(request.rootPid)
  if (root.status === 'error') return { proven: false, live: false }
  if (root.status === 'absent') return { proven: true, live: false }
  const proven =
    root.info.startedAt === request.rootIdentity &&
    root.uid === request.ownUid &&
    root.info.ttyIdentity === request.ttyIdentity
  return { proven, live: proven && !root.info.zombie }
}

function signalTtyMembers(platform: PlatformKernel, request: TtySignalRequest, pids: number[]) {
  const tally = new TtySignalTally()
  for (const pid of pids) {
    if (pid === request.rootPid || pid === process.pid) continue
    const member = platform.read(pid)
    if (member.status === 'absent') continue
    if (member.status === 'error') {
      tally.failed = true
      break
    }
    const owned =
      !member.info.zombie &&
      member.uid === request.ownUid &&
      member.info.ttyIdentity === request.ttyIdentity
    if (owned && !tally.record(platform.signal(pid, member.info.startedAt, request.signal))) break
  }
  return tally
}

function signalByTty(platform: PlatformKernel, request: TtySignalRequest) {
  const root = rootIsProven(platform, request)
  if (!root.proven) return TTY_UNPROVEN
  const pids = platform.listPids()
  if (!pids) return TTY_UNPROVEN
  const tally = signalTtyMembers(platform, request, pids)
  // The root goes last, by its identity: a root that exited meanwhile is never replaced by
  // whatever took its pid.
  if (!tally.failed && root.live) {
    tally.record(platform.signal(request.rootPid, request.rootIdentity, request.signal))
  }
  return tally.result()
}

function createKernel(platform: PlatformKernel): PosixKernel {
  const ownUid = process.getuid?.() ?? -1
  return {
    ttyPath: platform.ttyPath,
    processInfos: (pids) => {
      assertPids(pids)
      return pids.flatMap((pid) => {
        const read = platform.read(pid)
        if (read.status === 'error') throw new Error(`Could not read process ${String(pid)}.`)
        return read.status === 'found' ? [read.info] : []
      })
    },
    signalProcess: (pid, identity, signal) => platform.signal(pid, identity, signal),
    signalByTty: (handle, ttyIdentity, rootPid, rootIdentity, signal) => {
      if (terminalHandles.get(handle)?.() !== ttyIdentity) return TTY_UNPROVEN
      return signalByTty(platform, { ttyIdentity, rootPid, rootIdentity, signal, ownUid })
    },
  }
}

/** The kernel primitives of this platform, or null where neither macOS nor Linux applies. */
export async function loadPosixKernel(platform = process.platform): Promise<PosixKernel | null> {
  if (platform === 'darwin') {
    const [ffi, { darwinKernel }] = await Promise.all([
      import('bun:ffi'),
      import('./posix-kernel-darwin'),
    ])
    return createKernel(darwinKernel(ffi))
  }
  if (platform === 'linux') {
    const [ffi, { linuxKernel }] = await Promise.all([
      import('bun:ffi'),
      import('./posix-kernel-linux'),
    ])
    return createKernel(linuxKernel(ffi))
  }
  return null
}
