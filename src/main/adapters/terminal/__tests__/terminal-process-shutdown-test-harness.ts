import { fromPartial } from '@total-typescript/shoehorn'
import type { IPty } from 'node-pty'
import { type Mock, vi } from 'vitest'
import type {
  TerminalKernelProcessInfo,
  TerminalProcessMetadata,
} from '../terminal-process-identity'
import type { ProcessRow } from '../terminal-process-inspector'
import type { ProcessProbeOptions, ProcessTableTarget } from '../terminal-process-probes'
import type {
  LiveTerminalProcess,
  RetainedTerminalProcess,
  TerminalRecord,
} from '../terminal-records'
import { makeTerminalLifecycleHarness } from './terminal-lifecycle-test-harness'

type ReadProcessTable = (
  target?: ProcessTableTarget,
  options?: ProcessProbeOptions,
) => Promise<Map<number, ProcessRow> | null>

interface ShutdownProbes {
  readonly readProcessTable: Mock<ReadProcessTable>
  readonly readProcessMetadata: Mock<
    (pid: number, timeoutMs?: number) => Promise<TerminalProcessMetadata | null>
  >
  readonly signalLiveTerminalTtyMembers: Mock<
    (
      live: LiveTerminalProcess,
      force: boolean,
    ) => 'signaled' | 'no-match' | 'partial' | 'unavailable'
  >
  readonly readTerminalKernelProcessInfo: Mock<
    (
      pid: number,
    ) =>
      | { readonly status: 'found'; readonly info: TerminalKernelProcessInfo }
      | { readonly status: 'absent' }
      | { readonly status: 'unavailable' }
  >
  readonly signalTerminalProcessIdentity: Mock<
    (
      identity: { readonly pid: number; readonly startedAt: string },
      signal: 'SIGKILL',
    ) => 'signaled' | 'absent' | 'mismatch' | 'unavailable'
  >
}

const probes: ShutdownProbes = vi.hoisted(() => ({
  readProcessTable: vi.fn(),
  readProcessMetadata: vi.fn(),
  signalLiveTerminalTtyMembers: vi.fn(),
  readTerminalKernelProcessInfo: vi.fn(),
  signalTerminalProcessIdentity: vi.fn(),
}))

vi.mock('../terminal-process-probes', () => ({
  NO_TTY_FOREGROUND_GROUP: -1,
  parsePosixRow: vi.fn(),
  readListeningPorts: vi.fn(),
  readProcessMetadata: probes.readProcessMetadata,
  readProcessTable: probes.readProcessTable,
}))

vi.mock('../terminal-tty-signal', () => ({
  retryLiveTerminalTtySignal: async (live: LiveTerminalProcess, force: boolean) =>
    probes.signalLiveTerminalTtyMembers(live, force),
  signalLiveTerminalTtyMembers: probes.signalLiveTerminalTtyMembers,
  terminalTtySignalResolvedRoot: (result: string) => result === 'signaled',
}))

vi.mock('../terminal-process-kernel-api', () => ({
  readTerminalKernelProcessInfo: probes.readTerminalKernelProcessInfo,
  signalTerminalProcessIdentity: probes.signalTerminalProcessIdentity,
}))

export const {
  shutdownDetachedTerminal,
  shutdownLiveTerminal,
  TERMINAL_FORCE_SHUTDOWN_MS,
  TERMINAL_GRACEFUL_SHUTDOWN_MS,
  TERMINAL_SHUTDOWN_PIPELINE_MS,
} = await import('../terminal-process-shutdown')
export const { refreshTerminalProcessPids } = await import('../terminal-process-tree')
export const ROOT_PID = 71_001
export const EARLY_CHILD_PID = 71_002
export const LATE_CHILD_PID = 71_003

export function getTerminalProcessShutdownProbes(): ShutdownProbes {
  return probes
}

export function row(pid: number, ppid: number, name: string, zombie = false): ProcessRow {
  return {
    pid,
    ppid,
    pgid: pid,
    tpgid: pid,
    tty: null,
    ttyIdentity: null,
    identityVerified: true,
    zombie,
    startedAt: `start-${pid}`,
    name,
  }
}

export function identities(...pids: readonly number[]) {
  return pids.map((pid) => ({ pid, startedAt: `start-${pid}` }))
}

export function table(...rows: readonly ProcessRow[]) {
  return new Map(rows.map((entry) => [entry.pid, entry]))
}

export function missingProcessError() {
  return Object.assign(new Error('process is gone'), { code: 'ESRCH' })
}

export function makeLiveProcess(
  pid = ROOT_PID,
  processMetadata: Promise<TerminalProcessMetadata | null> = Promise.resolve({
    pid,
    startedAt: `start-${pid}`,
    tty: null,
    ttyIdentity: null,
  }),
) {
  const nativeLifecycle = makeTerminalLifecycleHarness()
  const { exitListeners } = nativeLifecycle
  const kill = vi.fn<(signal?: string) => void>()
  const destroy = vi.fn<() => void>()
  const closeDescriptor = vi.fn<() => void>(() => {
    destroy()
    nativeLifecycle.emitExit(0)
  })
  const publicDestroy = vi.fn<() => void>(() => kill('SIGHUP'))
  const pauseOutput = vi.fn<() => void>()
  const resumeOutput = vi.fn<() => void>()
  const pty = fromPartial<IPty>({
    pid,
    kill,
    onExit: (listener: (event: { exitCode: number }) => void) => {
      exitListeners.push(listener)
      return { dispose: () => undefined }
    },
  })
  Reflect.set(pty, '_socket', { destroy })
  Reflect.set(pty, 'closeDescriptor', closeDescriptor)
  Reflect.set(pty, 'destroy', publicDestroy)
  const lifecycle = nativeLifecycle.install(pty)
  const live: LiveTerminalProcess = {
    pty,
    pid,
    pauseOutput,
    resumeOutput,
    tty: null,
    ttyIdentity: null,
    processIdentity: { pid, startedAt: `start-${pid}` },
    processMetadata,
    ...lifecycle,
    outputPaused: false,
  }
  return {
    live,
    kill,
    destroy,
    closeDescriptor,
    publicDestroy,
    emitExit: (exitCode = 0) => {
      nativeLifecycle.emitExit(exitCode)
    },
    emitProcessTreeExit: nativeLifecycle.emitProcessTreeExit,
    resolveResourceDrain: nativeLifecycle.resolveResourceDrain,
    rejectResourceDrain: nativeLifecycle.rejectResourceDrain,
    emitPublicExit: nativeLifecycle.emitPublicExit,
  }
}

export function makeRecord(live: LiveTerminalProcess) {
  return fromPartial<TerminalRecord>({
    live,
    drainingProcesses: new Set(),
    termination: null,
    spawnGeneration: 1,
    promptDetector: null,
    exitCode: null,
    activity: {
      processName: null,
      processNames: [],
      ports: [],
      processPids: [live.pid],
      processIdentities: identities(live.pid),
      tty: null,
      processReliable: true,
      reliable: true,
    },
    pendingOutputBytes: 0,
    inFlightOutput: null,
  })
}

export function makeRetainedProcess(
  live: LiveTerminalProcess,
  processPids: readonly number[] = [live.pid],
  processIdentities = live.processIdentity === null ? [] : [live.processIdentity],
): RetainedTerminalProcess {
  return {
    live,
    owner: makeRecord(live),
    terminationCommitted: false,
    markOwnerInactiveOnRelease: false,
    processPids: [...processPids],
    processIdentities: [...processIdentities],
  }
}

export function setupTerminalProcessShutdownTest() {
  probes.readProcessTable.mockReset()
  probes.readProcessMetadata.mockReset()
  probes.readProcessMetadata.mockImplementation((pid) =>
    Promise.resolve({ pid, startedAt: `start-${pid}`, tty: null, ttyIdentity: null }),
  )
  probes.signalLiveTerminalTtyMembers.mockReset()
  probes.signalLiveTerminalTtyMembers.mockReturnValue('unavailable')
  probes.readTerminalKernelProcessInfo.mockReset()
  probes.readTerminalKernelProcessInfo.mockReturnValue({ status: 'unavailable' })
  probes.signalTerminalProcessIdentity.mockReset()
  probes.signalTerminalProcessIdentity.mockReturnValue('unavailable')
}

export function teardownTerminalProcessShutdownTest() {
  vi.useRealTimers()
  vi.restoreAllMocks()
}
