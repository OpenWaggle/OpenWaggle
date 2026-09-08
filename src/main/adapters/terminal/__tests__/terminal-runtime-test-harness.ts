import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TerminalEventPayload, TerminalOpenInput } from '@shared/types/terminal'
import { fromPartial } from '@total-typescript/shoehorn'
import type { IPty } from 'node-pty'
import { type Mock, vi } from 'vitest'
import { makeTerminalHistoryStore } from '../terminal-history-store'
import type { PtyRunner, PtySpawnOutcome, PtySpawnRequest } from '../terminal-pty-runner'
import type { TerminalRuntime, TerminalRuntimeDeps } from '../terminal-runtime'
import { makeTerminalRuntime } from '../terminal-runtime'
import { makeTerminalLifecycleHarness } from './terminal-lifecycle-test-harness'

export const ESC = '\x1b'
export const BEL = '\x07'
export const FAKE_PID = 987_654

export const INPUT: TerminalOpenInput = {
  ownerKey: 'session-1',
  terminalId: 'main',
  cwd: '/worktrees/session-1',
  cols: 120,
  rows: 40,
}

export interface FakePty {
  readonly pty: IPty
  readonly dataListeners: Array<(data: string) => void>
  readonly exitListeners: Array<(event: { readonly exitCode: number }) => void>
  readonly emitExit: (exitCode?: number) => void
  readonly emitProcessTreeExit: (exitCode?: number) => void
  readonly resolveResourceDrain: () => void
  readonly rejectResourceDrain: (error: Error) => void
  readonly emitPublicExit: (exitCode?: number) => void
  readonly write: ReturnType<typeof vi.fn>
  readonly kill: ReturnType<typeof vi.fn>
  readonly destroy: ReturnType<typeof vi.fn>
  readonly resize: ReturnType<typeof vi.fn>
  readonly pauseOutput: Mock<() => void>
  readonly resumeOutput: Mock<() => void>
  readonly exit: ReturnType<ReturnType<typeof makeTerminalLifecycleHarness>['install']>['exit']
  readonly processTreeExit: ReturnType<
    ReturnType<typeof makeTerminalLifecycleHarness>['install']
  >['processTreeExit']
  readonly resourceDrain: ReturnType<
    ReturnType<typeof makeTerminalLifecycleHarness>['install']
  >['resourceDrain']
}

export function makeFakePty(pid: number): FakePty {
  const dataListeners: Array<(data: string) => void> = []
  const nativeLifecycle = makeTerminalLifecycleHarness()
  const { exitListeners } = nativeLifecycle
  const write = vi.fn()
  const { emitExit } = nativeLifecycle
  const kill = vi.fn(() => emitExit())
  const destroy = vi.fn(() => emitExit())
  const resize = vi.fn()
  const pauseOutput = vi.fn<() => void>()
  const resumeOutput = vi.fn<() => void>()
  const pty = fromPartial<IPty>({
    pid,
    onData: (listener: (data: string) => void) => {
      dataListeners.push(listener)
      return { dispose: () => undefined }
    },
    onExit: (listener: (event: { exitCode: number }) => void) => {
      exitListeners.push(listener)
      return { dispose: () => undefined }
    },
    write,
    kill,
    resize,
  })
  Reflect.set(pty, '_socket', { destroy })
  Reflect.set(pty, 'closeDescriptor', () => destroy())
  const lifecycle = nativeLifecycle.install(pty)
  return {
    pty,
    dataListeners,
    exitListeners,
    emitExit,
    emitProcessTreeExit: nativeLifecycle.emitProcessTreeExit,
    resolveResourceDrain: nativeLifecycle.resolveResourceDrain,
    rejectResourceDrain: nativeLifecycle.rejectResourceDrain,
    emitPublicExit: nativeLifecycle.emitPublicExit,
    write,
    kill,
    destroy,
    resize,
    pauseOutput,
    resumeOutput,
    ...lifecycle,
  }
}

export function successfulOutcome(fake: FakePty, tty: string | null = null): PtySpawnOutcome {
  return {
    ok: true,
    pty: fake.pty,
    pid: fake.pty.pid,
    shell: 'zsh',
    tty,
    ttyIdentity: null,
    processIdentity: { pid: fake.pty.pid, startedAt: `start-${fake.pty.pid}` },
    processMetadata: Promise.resolve(null),
    exit: fake.exit,
    processTreeExit: fake.processTreeExit,
    resourceDrain: fake.resourceDrain,
    pauseOutput: fake.pauseOutput,
    resumeOutput: fake.resumeOutput,
  }
}

let logsDir: string
let store: ReturnType<typeof makeTerminalHistoryStore>

interface RuntimeTestResult {
  readonly runtime: TerminalRuntime
  readonly spawn: Mock<PtyRunner['spawn']>
  readonly emit: Mock<(payload: TerminalEventPayload) => number>
  readonly emitted: TerminalEventPayload[]
  readonly onLivePidsChanged: Mock<() => void>
}

export async function setupTerminalRuntimeTest() {
  logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-runtime-'))
  store = makeTerminalHistoryStore(logsDir)
  vi.useFakeTimers()
}

export async function teardownTerminalRuntimeTest() {
  await store.flush()
  vi.useRealTimers()
  await fs.rm(logsDir, { recursive: true, force: true })
}

export function makeRuntime(
  fake: FakePty,
  deliveryCount = 1,
  options: Pick<TerminalRuntimeDeps, 'shutdownDetachedProcess'> = {},
): RuntimeTestResult {
  const spawn = vi.fn(
    async (_request: PtySpawnRequest): Promise<PtySpawnOutcome> => successfulOutcome(fake),
  )
  const runner: PtyRunner = {
    spawn,
    load: () => Promise.resolve(fromPartial({ spawn: () => fake.pty })),
  }
  const emitted: TerminalEventPayload[] = []
  const emit = vi.fn((payload: TerminalEventPayload) => {
    emitted.push(payload)
    return deliveryCount
  })
  const onLivePidsChanged = vi.fn()
  const runtime = makeTerminalRuntime({
    runner,
    history: store,
    emit,
    onLivePidsChanged,
    ...options,
  })
  return { runtime, spawn, emit, emitted, onLivePidsChanged }
}

export function addRecord(runtime: TerminalRuntime) {
  const record = runtime.makeRecord(INPUT, INPUT.cwd)
  runtime.records.set(record.key, record)
  return record
}
