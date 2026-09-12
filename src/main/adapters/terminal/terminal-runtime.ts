import type {
  TerminalId,
  TerminalInputIntent,
  TerminalInputReleaseResult,
  TerminalKey,
  TerminalOpenInput,
  TerminalRuntimeEvent,
  TerminalWriteResult,
} from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import { normalizeTerminalEnvironment } from '@shared/utils/terminal-environment'
import { createLogger } from '../../logger'
import { createTerminalHistorySanitizer } from './terminal-history-sanitizer'
import type { TerminalHistoryStore } from './terminal-history-store'
import { makeTerminalInputFlow } from './terminal-input-flow'
import { makeTerminalOutputFlow } from './terminal-output-flow'
import { shutdownLiveTerminal } from './terminal-process-shutdown'
import type { PtyRunner } from './terminal-pty-runner'
import type { RetainedTerminalProcess, TerminalRecord } from './terminal-records'
import { TerminalRetainedProcesses } from './terminal-retained-processes'
import { createTerminalScrollback } from './terminal-scrollback'
import { makeTerminalSpawner } from './terminal-spawn-controller'

const logger = createLogger('terminal-runtime')
const SPAWN_SETTLE_BEFORE_SHUTDOWN_MS = 250

export { TERMINAL_RESOURCE_DRAIN_MS } from './terminal-retained-processes'

export type { TerminalRecord }

/** Registry, acknowledged output delivery, prompt readiness, and shell lifecycle. */
export interface TerminalRuntime {
  readonly records: Map<string, TerminalRecord>
  readonly history: TerminalHistoryStore
  readonly emitEvent: (record: TerminalRecord, event: TerminalRuntimeEvent) => void
  readonly flushOutputs: () => void
  /** Stop a live process tree and resolve after authoritative tree exit proof. */
  readonly killLive: (record: TerminalRecord) => Promise<boolean>
  /** Prove every retained process tree stopped without waiting on native I/O teardown. */
  readonly shutdownDetachedProcessTrees: (records?: readonly TerminalRecord[]) => Promise<boolean>
  /** Stop every retained tree and await native resource plus final-output drain. */
  readonly shutdownDetachedProcesses: (records?: readonly TerminalRecord[]) => Promise<boolean>
  /** A dead public record can still own descendants or native PTY resources. */
  readonly hasDetachedProcesses: (record: TerminalRecord) => boolean
  readonly spawn: (
    record: TerminalRecord,
    cols: number,
    rows: number,
    expectedReadinessNonce?: string,
  ) => void
  readonly makeRecord: (input: TerminalOpenInput, cwd: string) => TerminalRecord
  readonly discardPendingOutput: (key: TerminalKey) => void
  readonly rekeyRecord: (oldKey: TerminalKey, newKey: TerminalKey) => void
  readonly resetOutputStream: (record: TerminalRecord) => void
  readonly writeInput: (
    record: TerminalRecord,
    data: string,
    intent?: TerminalInputIntent,
  ) => TerminalWriteResult
  readonly stageInputForLaunch: (
    record: TerminalRecord,
    data: string,
    intent?: TerminalInputIntent,
  ) => TerminalWriteResult
  readonly resumeInput: (record: TerminalRecord) => void
  readonly forceReleaseInput: (record: TerminalRecord) => TerminalInputReleaseResult
  readonly acknowledgeOutput: (
    record: TerminalRecord,
    outputGeneration: number,
    endOffset: number,
  ) => void
  readonly reconcileOutputSnapshot: (
    record: TerminalRecord,
    outputGeneration: number,
    outputBytes: number,
  ) => void
  readonly observeProjectActionActivity: (record: TerminalRecord) => void
  readonly prepareProjectActionForRestart: (record: TerminalRecord) => void
}

export interface TerminalRuntimeDeps {
  readonly runner: PtyRunner
  readonly history: TerminalHistoryStore
  /** Deliver one runtime event and report how many surfaces received it. */
  readonly emit: (payload: {
    readonly ownerKey: string
    readonly terminalId: TerminalId
    readonly event: TerminalRuntimeEvent
  }) => number | Promise<number>
  readonly onLivePidsChanged: () => void
  readonly onRecordActive?: (record: TerminalRecord) => void
  readonly onRecordInactive?: (record: TerminalRecord) => void
  readonly onOutputDrained?: (record: TerminalRecord) => void
  readonly onRecordMetadataChanged?: (record: TerminalRecord) => void
  readonly shutdownDetachedProcess?: (target: RetainedTerminalProcess) => Promise<boolean>
}

function waitForPendingSpawns(tasks: ReadonlySet<Promise<void>>) {
  if (tasks.size === 0) return Promise.resolve(true)
  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), SPAWN_SETTLE_BEFORE_SHUTDOWN_MS)
  })
  return Promise.race([Promise.all([...tasks]).then(() => true), timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer)
  })
}

function makeRecord(input: TerminalOpenInput, cwd: string): TerminalRecord {
  return {
    key: terminalKeyOf(input.ownerKey, input.terminalId),
    ownerKey: input.ownerKey,
    terminalId: input.terminalId,
    cwd,
    env: normalizeTerminalEnvironment(input.env),
    scrollback: createTerminalScrollback(),
    sanitizer: createTerminalHistorySanitizer(),
    pendingOutput: '',
    pendingOutputBytes: 0,
    inFlightOutput: null,
    pendingInput: [],
    pendingInputBytes: 0,
    inputGeneration: input.inputGeneration ?? null,
    lastInputReceipt: null,
    pendingStartOffset: 0,
    outputBytes: 0,
    outputGeneration: 0,
    spawnGeneration: 0,
    readinessPhase: 'spawning',
    readinessGeneration: 0,
    promptDetector: null,
    promptEpoch: 0,
    projectAction: null,
    exitCode: null,
    closed: false,
    live: null,
    drainingProcesses: new Set(),
    termination: null,
    activity: null,
    ownerMigration: null,
  }
}

export function makeTerminalRuntime(deps: TerminalRuntimeDeps): TerminalRuntime {
  const { history, runner } = deps
  const records = new Map<string, TerminalRecord>()
  const pendingSpawns = new WeakMap<TerminalRecord, Set<Promise<void>>>()
  const output = makeTerminalOutputFlow({
    records,
    emit: deps.emit,
    onOutputDrained: deps.onOutputDrained ?? (() => undefined),
  })

  const emitEvent = (record: TerminalRecord, event: TerminalRuntimeEvent) => {
    void Promise.resolve(
      deps.emit({ ownerKey: record.ownerKey, terminalId: record.terminalId, event }),
    ).catch(() => undefined)
  }

  const input = makeTerminalInputFlow({
    emitEvent,
    onProjectActionChanged: deps.onRecordMetadataChanged ?? (() => undefined),
  })
  const onRecordInactive = deps.onRecordInactive ?? (() => undefined)

  const retained = new TerminalRetainedProcesses(onRecordInactive, deps.shutdownDetachedProcess)
  const {
    registerDetachedProcess,
    shutdownRetainedProcess,
    shutdownRetainedProcessTrees,
    shutdownRetainedProcesses,
  } = retained

  const spawn = makeTerminalSpawner({
    runner,
    history,
    input,
    output,
    pendingSpawns,
    registerDetachedProcess,
    shutdownRetainedProcess,
    emitEvent,
    onLivePidsChanged: deps.onLivePidsChanged,
    onRecordActive: deps.onRecordActive ?? (() => undefined),
    onRecordInactive,
  })

  const killLive = async (record: TerminalRecord) => {
    const tasks = pendingSpawns.get(record)
    if (tasks !== undefined && !(await waitForPendingSpawns(tasks))) {
      logger.error('Terminal spawn did not settle before bounded shutdown', {
        key: record.key,
      })
      return false
    }
    if (!(await retained.shutdownRetainedProcessTrees(new Set([record])))) return false
    const live = record.live
    const activityPids = record.activity?.processPids ?? []
    const activityIdentities = record.activity?.processIdentities ?? []
    const stoppedLive = await shutdownLiveTerminal(record, deps.onLivePidsChanged)
    if (stoppedLive && live !== null) {
      const target = registerDetachedProcess(
        record,
        live,
        activityPids,
        activityIdentities,
        true,
        false,
      )
      void shutdownRetainedProcess(target)
      if (record.exitCode === null) {
        record.exitCode = live.processTreeExit.exitCode ?? live.exit.exitCode ?? -1
      }
    }
    return stoppedLive && !retained.hasUncommittedOwner(record)
  }

  const ownerSet = (targetRecords?: readonly TerminalRecord[]) =>
    targetRecords === undefined ? undefined : new Set(targetRecords)

  const shutdownDetachedProcessTrees = (targetRecords?: readonly TerminalRecord[]) =>
    shutdownRetainedProcessTrees(ownerSet(targetRecords))

  const shutdownDetachedProcesses = (targetRecords?: readonly TerminalRecord[]) =>
    shutdownRetainedProcesses(ownerSet(targetRecords))

  return {
    records,
    history,
    emitEvent,
    flushOutputs: output.flush,
    killLive,
    shutdownDetachedProcessTrees,
    shutdownDetachedProcesses,
    hasDetachedProcesses: (record) => retained.hasOwner(record),
    spawn,
    makeRecord,
    discardPendingOutput: output.discard,
    rekeyRecord: output.rekey,
    resetOutputStream: output.resetStream,
    writeInput: input.write,
    stageInputForLaunch: input.stageForLaunch,
    resumeInput: input.resume,
    forceReleaseInput: input.forceRelease,
    acknowledgeOutput: output.acknowledge,
    reconcileOutputSnapshot: output.reconcileSnapshot,
    observeProjectActionActivity: input.observeProjectActionActivity,
    prepareProjectActionForRestart: input.prepareProjectActionForRestart,
  }
}
