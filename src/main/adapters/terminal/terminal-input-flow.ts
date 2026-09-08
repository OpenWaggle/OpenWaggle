import { Buffer } from 'node:buffer'
import { TERMINAL } from '@shared/constants/resource-limits'
import type {
  TerminalInputIntent,
  TerminalInputReleaseResult,
  TerminalReadinessPhase,
  TerminalRuntimeEvent,
  TerminalWriteResult,
} from '@shared/types/terminal'
import { createLogger } from '../../logger'
import {
  beginTerminalProjectAction,
  clearTerminalProjectAction,
  markTerminalProjectActionDelivered,
  observeTerminalProjectActionActivity,
  observeTerminalPromptMarkers,
  prepareTerminalProjectActionForRestart,
  terminalInputByteLimit,
} from './terminal-project-action'
import type { TerminalRecord } from './terminal-records'

const logger = createLogger('terminal-input-flow')

interface TerminalInputFlowDeps {
  readonly emitEvent: (record: TerminalRecord, event: TerminalRuntimeEvent) => void
  readonly onProjectActionChanged: (record: TerminalRecord) => void
}

export interface TerminalInputFlow {
  readonly setReadiness: (
    record: TerminalRecord,
    generation: number,
    phase: TerminalReadinessPhase,
  ) => void
  readonly emitReadiness: (record: TerminalRecord) => void
  readonly write: (
    record: TerminalRecord,
    data: string,
    intent?: TerminalInputIntent,
  ) => TerminalWriteResult
  readonly stageForLaunch: (
    record: TerminalRecord,
    data: string,
    intent?: TerminalInputIntent,
  ) => TerminalWriteResult
  readonly resume: (record: TerminalRecord) => void
  readonly forceRelease: (record: TerminalRecord) => TerminalInputReleaseResult
  readonly observePromptMarkers: (record: TerminalRecord, generation: number, count: number) => void
  readonly observeProjectActionActivity: (record: TerminalRecord) => void
  readonly prepareProjectActionForRestart: (record: TerminalRecord) => void
  readonly dropProjectActionOnExit: (record: TerminalRecord) => void
}

function readinessEvent(record: TerminalRecord) {
  return {
    type: 'readiness',
    readiness: {
      phase: record.readinessPhase,
      generation: record.readinessGeneration,
    },
  } as const
}

function drainPendingInput(record: TerminalRecord) {
  const live = record.live
  if (
    live === null ||
    record.termination !== null ||
    record.exitCode !== null ||
    record.readinessPhase !== 'ready' ||
    record.readinessGeneration !== record.spawnGeneration ||
    record.pendingInput.length === 0
  ) {
    return null
  }
  let releasedBytes = 0
  while (record.pendingInput.length > 0) {
    const part = record.pendingInput[0]
    if (part === undefined) break
    const byteLength = Buffer.byteLength(part.data, 'utf8')
    try {
      live.pty.write(part.data)
    } catch (error) {
      logger.warn('Terminal input write failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      return releasedBytes === 0 ? null : releasedBytes
    }
    record.pendingInput.shift()
    record.pendingInputBytes -= byteLength
    releasedBytes += byteLength
    markTerminalProjectActionDelivered(record, part.intent)
  }
  return releasedBytes
}

function terminalInputUnavailable(record: TerminalRecord, deferUntilLaunch: boolean) {
  if (record.closed) return true
  if (deferUntilLaunch) return false
  return record.termination !== null || record.exitCode !== null
}

export function makeTerminalInputFlow(deps: TerminalInputFlowDeps): TerminalInputFlow {
  const emitReadiness = (record: TerminalRecord) => {
    deps.emitEvent(record, readinessEvent(record))
  }

  const setReadiness = (
    record: TerminalRecord,
    generation: number,
    phase: TerminalReadinessPhase,
  ) => {
    if (generation !== record.spawnGeneration || record.readinessGeneration !== generation) return
    if (record.readinessPhase === phase) return
    record.readinessPhase = phase
    emitReadiness(record)
    if (phase === 'ready') drainPendingInput(record)
  }

  const enqueue = (
    record: TerminalRecord,
    data: string,
    intent: TerminalInputIntent | undefined,
    deferUntilLaunch: boolean,
  ): TerminalWriteResult => {
    const acceptedBytes = Buffer.byteLength(data, 'utf8')
    if (acceptedBytes === 0) return { status: 'rejected', acceptedBytes: 0, reason: 'empty' }
    if (terminalInputUnavailable(record, deferUntilLaunch)) {
      return { status: 'rejected', acceptedBytes: 0, reason: 'terminal-not-open' }
    }
    if (acceptedBytes > terminalInputByteLimit(intent)) {
      return { status: 'rejected', acceptedBytes: 0, reason: 'input-too-large' }
    }
    if (record.pendingInputBytes + acceptedBytes > TERMINAL.MAX_PENDING_INPUT_BYTES) {
      return { status: 'rejected', acceptedBytes: 0, reason: 'queue-full' }
    }
    if (!beginTerminalProjectAction(record, intent)) {
      return { status: 'rejected', acceptedBytes: 0, reason: 'project-action-pending' }
    }
    record.pendingInput.push({ data, ...(intent === undefined ? {} : { intent }) })
    record.pendingInputBytes += acceptedBytes
    if (!deferUntilLaunch) drainPendingInput(record)
    if (intent?.kind === 'project-action') deps.onProjectActionChanged(record)
    return {
      status: !deferUntilLaunch && record.pendingInput.length === 0 ? 'written' : 'queued',
      acceptedBytes,
    }
  }

  const write = (record: TerminalRecord, data: string, intent?: TerminalInputIntent) =>
    enqueue(record, data, intent, false)

  const stageForLaunch = (record: TerminalRecord, data: string, intent?: TerminalInputIntent) =>
    enqueue(record, data, intent, true)

  const forceRelease = (record: TerminalRecord): TerminalInputReleaseResult => {
    if (record.live === null || record.termination !== null || record.exitCode !== null) {
      return { status: 'terminal-not-open', releasedBytes: 0 }
    }
    if (record.readinessPhase === 'ready') {
      return { status: 'already-ready', releasedBytes: 0 }
    }
    record.readinessPhase = 'ready'
    emitReadiness(record)
    const releasedBytes = drainPendingInput(record) ?? 0
    return { status: 'released', releasedBytes }
  }

  const observePromptMarkerBatch = (record: TerminalRecord, generation: number, count: number) => {
    if (generation !== record.spawnGeneration || count <= 0) return
    if (observeTerminalPromptMarkers(record, count)) deps.onProjectActionChanged(record)
    if (record.readinessPhase !== 'ready') setReadiness(record, generation, 'ready')
  }

  const observeProjectActionActivity = (record: TerminalRecord) => {
    if (observeTerminalProjectActionActivity(record)) deps.onProjectActionChanged(record)
  }

  const prepareProjectActionForRestart = (record: TerminalRecord) => {
    if (prepareTerminalProjectActionForRestart(record)) deps.onProjectActionChanged(record)
  }

  const dropProjectActionOnExit = (record: TerminalRecord) => {
    if (clearTerminalProjectAction(record, true)) deps.onProjectActionChanged(record)
  }

  return {
    setReadiness,
    emitReadiness,
    write,
    stageForLaunch,
    resume: (record) => {
      drainPendingInput(record)
    },
    forceRelease,
    observePromptMarkers: observePromptMarkerBatch,
    observeProjectActionActivity,
    prepareProjectActionForRestart,
    dropProjectActionOnExit,
  }
}
