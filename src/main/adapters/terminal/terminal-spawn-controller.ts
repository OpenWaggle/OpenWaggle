import { randomBytes } from 'node:crypto'
import type { IPty } from 'node-pty'
import { createLogger } from '../../logger'
import { normalizeTerminalExitCode } from './terminal-exit-code'
import { createTerminalHistorySanitizer } from './terminal-history-sanitizer'
import { createTerminalPromptReadinessDetector } from './terminal-prompt-readiness'
import type { PtySpawnOutcome } from './terminal-pty-runner'
import type { LiveTerminalProcess, TerminalRecord } from './terminal-records'

import type { TerminalSpawnerDeps } from './terminal-spawn-types'

const logger = createLogger('terminal-runtime')
const SPAWN_FAILED_EXIT_CODE = -1
const READINESS_NONCE_BYTES = 18
type SuccessfulPtySpawn = Extract<PtySpawnOutcome, { readonly ok: true }>

function deferInactiveRetention(record: TerminalRecord, retain: () => void) {
  const immediate = setImmediate(() => {
    if (record.live === null && record.exitCode !== null && !record.closed) retain()
  })
  immediate.unref?.()
}

function wireShellStreams(
  record: TerminalRecord,
  live: LiveTerminalProcess,
  generation: number,
  deps: Pick<
    TerminalSpawnerDeps,
    | 'history'
    | 'input'
    | 'output'
    | 'emitEvent'
    | 'onLivePidsChanged'
    | 'onRecordInactive'
    | 'registerDetachedProcess'
    | 'shutdownRetainedProcess'
  >,
) {
  const { pty } = live
  pty.onData((data: string) => {
    const isCurrent = generation === record.spawnGeneration && record.live?.pty === pty
    const isDraining = record.drainingProcesses.has(live)
    if (record.closed || (!isCurrent && !isDraining)) return

    const promptMarkers = isCurrent ? (record.promptDetector?.feed(data) ?? 0) : 0
    const sanitized = record.sanitizer.feed(data)
    record.scrollback.append(sanitized)
    if (record.ownerMigration === null) deps.history.append(record.key, sanitized)
    else record.ownerMigration.historyBuffer += sanitized
    deps.output.append(record, data)
    if (isCurrent) deps.input.observePromptMarkers(record, generation, promptMarkers)
  })

  let exitHandled = false
  const handleExit = () => {
    if (exitHandled) return
    const exitCode = normalizeTerminalExitCode(live.exit.exitCode)
    if (generation !== record.spawnGeneration || record.live?.pty !== pty || record.closed) return
    const termination = record.termination
    if (termination?.pty === pty) {
      // Public exit can race a bounded tree-proof attempt. A successful
      // attempt transfers ownership in killLive; a failed attempt must replay
      // this already-observed exit so a dead PTY never remains publicly live.
      void termination.result.then((stopped) => {
        if (!stopped) handleExit()
      })
      return
    }
    exitHandled = true
    const retained = deps.registerDetachedProcess(
      record,
      live,
      record.activity?.processPids ?? [],
      record.activity?.processIdentities ?? [],
      false,
      true,
    )
    record.live = null
    record.exitCode = exitCode
    deps.input.dropProjectActionOnExit(record)
    deps.onLivePidsChanged()
    deps.emitEvent(record, { type: 'exited', exitCode })
    // node-pty delivers data before exit. Defer pruning until the I/O turn ends
    // so its final data callback has entered the acknowledged output flow.
    deferInactiveRetention(record, () => deps.onRecordInactive(record))
    void deps.shutdownRetainedProcess(retained)
  }
  void live.exit.whenExited.then(handleExit)
}

function attachLiveShell(
  deps: TerminalSpawnerDeps,
  record: TerminalRecord,
  pty: IPty,
  pid: number,
  tty: string | null,
  processIdentity: SuccessfulPtySpawn['processIdentity'],
  ttyIdentity: SuccessfulPtySpawn['ttyIdentity'],
  processMetadata: SuccessfulPtySpawn['processMetadata'],
  exit: SuccessfulPtySpawn['exit'],
  processTreeExit: SuccessfulPtySpawn['processTreeExit'],
  resourceDrain: SuccessfulPtySpawn['resourceDrain'],
  signalTtyMembers: SuccessfulPtySpawn['signalTtyMembers'],
  generation: number,
  pauseOutput: () => void,
  resumeOutput: () => void,
) {
  const live: LiveTerminalProcess = {
    pty,
    pid,
    pauseOutput,
    resumeOutput,
    tty,
    ttyIdentity,
    processIdentity,
    processMetadata,
    exit,
    processTreeExit,
    resourceDrain,
    outputPaused: true,
    ...(signalTtyMembers === undefined ? {} : { signalTtyMembers }),
  }
  record.live = live
  void processMetadata.then((metadata) => {
    if (record.live !== live || metadata === null || metadata.pid !== pid) return
    if (live.tty !== null || metadata.tty === null) return
    live.tty = metadata.tty
    deps.onLivePidsChanged()
  })
  record.exitCode = null
  deps.onLivePidsChanged()
  // The root shell is not child work. Reset any previous process label and
  // wait for the shared inspector to observe a real descendant.
  deps.emitEvent(record, { type: 'activity', processName: null })
  deps.input.setReadiness(record, generation, 'awaiting-prompt')
  wireShellStreams(record, live, generation, deps)
  live.resumeOutput()
  live.outputPaused = false
}

async function discardStaleSpawn(
  outcome: SuccessfulPtySpawn,
  generation: number,
  record: TerminalRecord,
  deps: Pick<TerminalSpawnerDeps, 'registerDetachedProcess' | 'shutdownRetainedProcess'>,
) {
  const live: LiveTerminalProcess = {
    pty: outcome.pty,
    pid: outcome.pid,
    pauseOutput: outcome.pauseOutput,
    resumeOutput: outcome.resumeOutput,
    tty: outcome.tty,
    ttyIdentity: outcome.ttyIdentity,
    processIdentity: outcome.processIdentity,
    processMetadata: outcome.processMetadata,
    exit: outcome.exit,
    processTreeExit: outcome.processTreeExit,
    resourceDrain: outcome.resourceDrain,
    outputPaused: true,
    ...(outcome.signalTtyMembers === undefined
      ? {}
      : { signalTtyMembers: outcome.signalTtyMembers }),
  }
  const retained = deps.registerDetachedProcess(record, live, [], [], false, false)
  let stopped = false
  try {
    stopped = await deps.shutdownRetainedProcess(retained)
  } catch (error) {
    logger.error('Stale terminal spawn cleanup failed', {
      pid: outcome.pid,
      generation,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  if (stopped) return
  logger.error('Stale terminal spawn could not be confirmed stopped', {
    pid: outcome.pid,
    generation,
  })
}

async function discardFailedAttachment(
  outcome: SuccessfulPtySpawn,
  generation: number,
  record: TerminalRecord,
  deps: Pick<
    TerminalSpawnerDeps,
    'registerDetachedProcess' | 'shutdownRetainedProcess' | 'onLivePidsChanged'
  >,
) {
  const attached = record.live?.pty === outcome.pty ? record.live : null
  if (attached === null) {
    await discardStaleSpawn(outcome, generation, record, deps)
    return
  }

  record.live = null
  record.drainingProcesses.add(attached)
  deps.onLivePidsChanged()
  const retained = deps.registerDetachedProcess(record, attached, [], [], false, false)
  const stopped = await deps.shutdownRetainedProcess(retained).catch((error: unknown) => {
    logger.error('Partially attached terminal cleanup failed', {
      pid: outcome.pid,
      generation,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  })
  if (stopped) return
  logger.error('Partially attached terminal could not be confirmed stopped', {
    pid: outcome.pid,
    generation,
  })
}

export function makeTerminalSpawner(deps: TerminalSpawnerDeps) {
  return (record: TerminalRecord, cols: number, rows: number, expectedReadinessNonce?: string) => {
    deps.onRecordActive(record)
    record.spawnGeneration += 1
    const generation = record.spawnGeneration
    deps.output.beginGeneration(record)
    record.readinessGeneration = generation
    record.readinessPhase = 'spawning'
    record.promptEpoch = 0
    // Null means a spawn is genuinely in flight. Failed and naturally exited
    // records carry an exit code, so writes cannot disappear into a dead shell.
    record.exitCode = null
    record.activity = null
    record.sanitizer = createTerminalHistorySanitizer()
    const readinessNonce =
      expectedReadinessNonce ?? randomBytes(READINESS_NONCE_BYTES).toString('base64url')
    record.promptDetector = createTerminalPromptReadinessDetector(readinessNonce)
    deps.input.emitReadiness(record)

    const task = deps.runner
      .spawn({ cwd: record.cwd, cols, rows, env: record.env, readinessNonce })
      .then(async (outcome) => {
        if (!outcome.ok) {
          logger.error('No terminal shell could be spawned', {
            cwd: record.cwd,
            error: outcome.error.message,
          })
          if (generation === record.spawnGeneration && !record.closed) {
            record.exitCode = SPAWN_FAILED_EXIT_CODE
            deps.input.dropProjectActionOnExit(record)
            deps.emitEvent(record, { type: 'exited', exitCode: SPAWN_FAILED_EXIT_CODE })
            deps.onRecordInactive(record)
          }
          return
        }
        if (generation !== record.spawnGeneration || record.closed) {
          await discardStaleSpawn(outcome, generation, record, deps)
          return
        }
        try {
          attachLiveShell(
            deps,
            record,
            outcome.pty,
            outcome.pid,
            outcome.tty,
            outcome.processIdentity,
            outcome.ttyIdentity,
            outcome.processMetadata,
            outcome.exit,
            outcome.processTreeExit,
            outcome.resourceDrain,
            outcome.signalTtyMembers,
            generation,
            outcome.pauseOutput,
            outcome.resumeOutput,
          )
        } catch (error) {
          await discardFailedAttachment(outcome, generation, record, deps)
          throw error
        }
      })
      .catch((error: unknown) => {
        logger.error('Terminal spawn pipeline failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        if (generation === record.spawnGeneration && !record.closed) {
          record.exitCode = SPAWN_FAILED_EXIT_CODE
          deps.input.dropProjectActionOnExit(record)
          deps.emitEvent(record, { type: 'exited', exitCode: SPAWN_FAILED_EXIT_CODE })
          deps.onRecordInactive(record)
        }
      })
    const tasks = deps.pendingSpawns.get(record) ?? new Set<Promise<void>>()
    tasks.add(task)
    deps.pendingSpawns.set(record, tasks)
    void task.then(
      () => tasks.delete(task),
      () => tasks.delete(task),
    )
  }
}
