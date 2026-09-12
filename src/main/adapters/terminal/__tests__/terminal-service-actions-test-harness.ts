import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TERMINAL } from '@shared/constants/resource-limits'
import type {
  TerminalActivitySnapshot,
  TerminalEventPayload,
  TerminalOpenInput,
} from '@shared/types/terminal'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import type { IPty } from 'node-pty'
import { expect, type Mock, vi } from 'vitest'
import type { TerminalEventSinkShape } from '../../../ports/terminal-event-sink'
import {
  makeNodePtyTerminalService,
  type NodePtyTerminalServiceOptions,
} from '../../node-pty-terminal-service'
import type { PtyRunner, PtySpawnOutcome, PtySpawnRequest } from '../terminal-pty-runner'
import { makeTerminalLifecycleHarness } from './terminal-lifecycle-test-harness'

export const OWNER = 'session-1'
export const TERMINAL_ID = 'main'
export const TERMINAL_KEY = `${OWNER}::${TERMINAL_ID}`
export const OUTPUT_FLUSH_MS = TERMINAL.OUTPUT_FLUSH_MS
const FAKE_PID = 4200

const runnerRef = vi.hoisted(() => {
  const ref: { current: PtyRunner | null } = { current: null }
  return ref
})

vi.mock('../terminal-pty-runner', () => ({
  makePtyRunner: () => {
    const runner = runnerRef.current
    if (runner === null) throw new Error('Fake PtyRunner was not configured for this test')
    return runner
  },
}))

vi.mock('../terminal-process-probes', () => ({
  NO_TTY_FOREGROUND_GROUP: -1,
  parsePosixRow: vi.fn(),
  readListeningPorts: vi.fn(() => Promise.resolve(null)),
  readProcessMetadata: vi.fn((pid: number) =>
    Promise.resolve({ pid, startedAt: `start-${pid}`, tty: null, ttyIdentity: null }),
  ),
  readProcessTty: vi.fn(() => Promise.resolve(null)),
  // Inspector probes stay conservatively unavailable. Shutdown passes a
  // target descriptor and receives an authoritative empty table for fake PIDs.
  readProcessTable: vi.fn((target: unknown) => {
    if (
      typeof target !== 'object' ||
      target === null ||
      !('rootPid' in target) ||
      typeof target.rootPid !== 'number'
    ) {
      return Promise.resolve(null)
    }
    const pid = target.rootPid
    return Promise.resolve(
      new Map([
        [
          pid,
          {
            pid,
            ppid: 1,
            pgid: pid,
            tpgid: pid,
            tty: null,
            ttyIdentity: null,
            identityVerified: true,
            zombie: false,
            startedAt: `start-${pid}`,
            name: 'zsh',
          },
        ],
      ]),
    )
  }),
}))

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
  readonly closeDescriptor: ReturnType<typeof vi.fn>
  readonly clear: ReturnType<typeof vi.fn>
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

function makeFakePty(pid: number): FakePty {
  const dataListeners: Array<(data: string) => void> = []
  const nativeLifecycle = makeTerminalLifecycleHarness()
  const { exitListeners } = nativeLifecycle
  const write = vi.fn()
  const { emitExit } = nativeLifecycle
  const kill = vi.fn(() => emitExit())
  const closeDescriptor = vi.fn(() => emitExit())
  const clear = vi.fn()
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
    clear,
  })
  Reflect.set(pty, 'closeDescriptor', closeDescriptor)
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
    closeDescriptor,
    clear,
    pauseOutput,
    resumeOutput,
    ...lifecycle,
  }
}

export function successfulOutcome(fake: FakePty): PtySpawnOutcome {
  return {
    ok: true,
    pty: fake.pty,
    pid: fake.pty.pid,
    shell: 'zsh',
    tty: null,
    ttyIdentity: null,
    processIdentity: { pid: fake.pty.pid, startedAt: `start-${fake.pty.pid}` },
    processMetadata: Promise.resolve({
      pid: fake.pty.pid,
      startedAt: `start-${fake.pty.pid}`,
      tty: null,
      ttyIdentity: null,
    }),
    exit: fake.exit,
    processTreeExit: fake.processTreeExit,
    resourceDrain: fake.resourceDrain,
    pauseOutput: fake.pauseOutput,
    resumeOutput: fake.resumeOutput,
  }
}

function makeRecordingSink() {
  const recordedEvents: TerminalEventPayload[] = []
  const recordedMoves: Array<readonly [string, string]> = []
  let nextMoveError: Error | null = null
  let deliveryCount = 1
  const sink: TerminalEventSinkShape = {
    emit: (payload) =>
      Effect.sync(() => {
        recordedEvents.push(payload)
        return deliveryCount
      }),
    attach: () => Effect.void,
    detach: () => Effect.succeed(true),
    move: (fromKey, toKey) =>
      Effect.sync(() => {
        if (nextMoveError !== null) {
          const error = nextMoveError
          nextMoveError = null
          throw error
        }
        recordedMoves.push([fromKey, toKey])
      }),
    detachSurface: () => Effect.succeed([]),
  }
  return {
    recordedEvents,
    recordedMoves,
    sink,
    failNextMove: (error: Error) => {
      nextMoveError = error
    },
    setDeliveryCount: (count: number) => {
      deliveryCount = count
    },
  }
}

type Service = ReturnType<typeof makeNodePtyTerminalService>

let logsDir: string
let holdSpawns = false
export let workDirA: string
export let workDirB: string
export let service: Service
export let events: TerminalEventPayload[]
export let moves: Array<readonly [string, string]>
export let failNextMove: (error: Error) => void
export let setDeliveryCount: (count: number) => void
export let spawn: Mock<PtyRunner['spawn']>
export let ptys: FakePty[]
export let heldSpawns: Array<(outcome: PtySpawnOutcome) => void>
export let activitySnapshots: TerminalActivitySnapshot[]

export const openInput = (cwd: string): TerminalOpenInput => ({
  ownerKey: OWNER,
  terminalId: TERMINAL_ID,
  cwd,
  cols: 120,
  rows: 40,
})

export const open = (cwd: string) => Effect.runPromise(service.open(openInput(cwd)))
export const settle = () => vi.advanceTimersByTimeAsync(0)
export const feed = (index: number, data: string) => ptys[index]?.dataListeners[0]?.(data)

export function readinessMarker(spawnIndex: number) {
  const nonce = spawn.mock.calls[spawnIndex]?.[0].readinessNonce
  if (nonce === undefined) throw new Error(`Expected readiness nonce for spawn ${spawnIndex}`)
  return `\x1b]633;B;${nonce}\x07`
}

export const expectEvent = (event: TerminalEventPayload['event']) =>
  expect(events).toContainEqual({ ownerKey: OWNER, terminalId: TERMINAL_ID, event })

export async function logFileCount() {
  const entries = await fs.readdir(logsDir)
  return entries.filter((entry) => entry.endsWith('.log')).length
}

export function holdFutureSpawns() {
  holdSpawns = true
}

type RetentionOptions = Pick<
  NodePtyTerminalServiceOptions,
  'maxInactiveRecords' | 'maxInactiveScrollbackBytes'
>

export async function setupTerminalServiceActionsTest(options: RetentionOptions = {}) {
  logsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-service-logs-'))
  workDirA = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-service-a-'))
  workDirB = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-service-b-'))
  ptys = []
  heldSpawns = []
  holdSpawns = false
  spawn = vi.fn((_request: PtySpawnRequest): Promise<PtySpawnOutcome> => {
    const fake = makeFakePty(FAKE_PID + ptys.length)
    ptys.push(fake)
    if (holdSpawns) {
      return new Promise<PtySpawnOutcome>((resolve) => {
        heldSpawns.push(resolve)
      })
    }
    return Promise.resolve(successfulOutcome(fake))
  })
  runnerRef.current = {
    spawn,
    load: () => new Promise<never>(() => undefined),
  }
  const recording = makeRecordingSink()
  activitySnapshots = []
  events = recording.recordedEvents
  moves = recording.recordedMoves
  failNextMove = recording.failNextMove
  setDeliveryCount = recording.setDeliveryCount
  service = makeNodePtyTerminalService(recording.sink, {
    logsDir,
    appVersion: '0.0.0-test',
    onRecordChanged: (snapshot) => activitySnapshots.push(snapshot),
    ...(typeof options.maxInactiveRecords === 'number'
      ? { maxInactiveRecords: options.maxInactiveRecords }
      : {}),
    ...(typeof options.maxInactiveScrollbackBytes === 'number'
      ? { maxInactiveScrollbackBytes: options.maxInactiveScrollbackBytes }
      : {}),
  })
  vi.useFakeTimers()
}

export async function teardownTerminalServiceActionsTest() {
  vi.useRealTimers()
  runnerRef.current = null
  await service.dispose()
  await fs.rm(logsDir, { recursive: true, force: true })
  await fs.rm(workDirA, { recursive: true, force: true })
  await fs.rm(workDirB, { recursive: true, force: true })
}
