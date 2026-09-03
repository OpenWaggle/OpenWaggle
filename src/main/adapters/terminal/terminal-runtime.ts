import { TERMINAL } from '@shared/constants/resource-limits'
import type {
  TerminalId,
  TerminalKey,
  TerminalOpenInput,
  TerminalRuntimeEvent,
} from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import type { IPty } from 'node-pty'
import { createLogger } from '../../logger'
import { createTerminalHistorySanitizer } from './terminal-history-sanitizer'
import type { TerminalHistoryStore } from './terminal-history-store'
import type { PtyRunner } from './terminal-pty-runner'
import type { TerminalRecord } from './terminal-records'
import { createTerminalScrollback } from './terminal-scrollback'

const logger = createLogger('terminal-runtime')

const SPAWN_FAILED_EXIT_CODE = -1

export type { TerminalRecord }

/**
 * Shared mutable runtime behind the terminal service: the record registry,
 * coalesced output delivery, and shell process lifecycle (ADR 0030).
 */
export interface TerminalRuntime {
  readonly records: Map<string, TerminalRecord>
  readonly history: TerminalHistoryStore
  readonly emitEvent: (record: TerminalRecord, event: TerminalRuntimeEvent) => void
  readonly flushOutputs: () => void
  readonly killLive: (record: TerminalRecord) => void
  readonly spawn: (record: TerminalRecord, cols: number, rows: number) => void
  readonly makeRecord: (input: TerminalOpenInput, cwd: string) => TerminalRecord
  readonly discardPendingOutput: (key: TerminalKey) => void
}

export interface TerminalRuntimeDeps {
  readonly runner: PtyRunner
  readonly history: TerminalHistoryStore
  /** Deliver one runtime event to attached surfaces. */
  readonly emit: (payload: {
    readonly ownerKey: string
    readonly terminalId: TerminalId
    readonly event: TerminalRuntimeEvent
  }) => void
  /** Notify that the set of live shell pids changed (drives the inspector). */
  readonly onLivePidsChanged: () => void
}

export function makeTerminalRuntime(deps: TerminalRuntimeDeps): TerminalRuntime {
  const { history, runner } = deps
  const records = new Map<string, TerminalRecord>()
  const dirty = new Set<TerminalKey>()
  let flushTimer: NodeJS.Timeout | null = null

  const emitEvent = (record: TerminalRecord, event: TerminalRuntimeEvent) => {
    void deps.emit({ ownerKey: record.ownerKey, terminalId: record.terminalId, event })
  }

  // Coalesced delivery: chunks buffer for OUTPUT_FLUSH_MS, then one event (ADR 0030).
  const flushOutputs = () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (dirty.size === 0) return
    const keys = [...dirty]
    dirty.clear()
    for (const key of keys) {
      const record = records.get(key)
      if (record === undefined || record.pendingOutput.length === 0) continue
      const data = record.pendingOutput
      const startOffset = record.pendingStartOffset
      record.pendingOutput = ''
      record.pendingStartOffset = record.outputBytes
      emitEvent(record, { type: 'output', data, startOffset, endOffset: record.outputBytes })
    }
  }

  const scheduleFlush = () => {
    if (flushTimer !== null) return
    flushTimer = setTimeout(flushOutputs, TERMINAL.OUTPUT_FLUSH_MS)
  }

  const killLive = (record: TerminalRecord) => {
    if (record.live === null) return
    record.spawnGeneration += 1
    try {
      record.live.pty.kill()
    } catch {
      // Shell may already be gone.
    }
    record.live = null
    deps.onLivePidsChanged()
  }

  const spawn = (record: TerminalRecord, cols: number, rows: number) => {
    record.spawnGeneration += 1
    const generation = record.spawnGeneration

    void runner
      .spawn({ cwd: record.cwd, cols, rows })
      .then((outcome) => {
        if (!outcome.ok) {
          logger.error('No terminal shell could be spawned', {
            cwd: record.cwd,
            error: outcome.error.message,
          })
          if (generation === record.spawnGeneration) {
            record.exitCode = SPAWN_FAILED_EXIT_CODE
            emitEvent(record, { type: 'exited', exitCode: SPAWN_FAILED_EXIT_CODE })
          }
          return
        }
        if (generation !== record.spawnGeneration) {
          outcome.pty.kill()
          return
        }
        attachLiveShell(record, outcome.pty, outcome.pid, generation)
      })
      .catch((error: unknown) => {
        logger.error('Terminal spawn pipeline failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const attachLiveShell = (record: TerminalRecord, pty: IPty, pid: number, generation: number) => {
    record.live = { pty, pid }
    record.exitCode = null
    deps.onLivePidsChanged()

    pty.onData((data: string) => {
      if (record.closed) return
      const sanitized = record.sanitizer.feed(data)
      record.scrollback.append(sanitized)
      history.append(record.key, sanitized)
      if (record.pendingOutput.length === 0) record.pendingStartOffset = record.outputBytes
      record.pendingOutput += data
      record.outputBytes += data.length
      dirty.add(record.key)
      scheduleFlush()
    })

    pty.onExit(({ exitCode }: { exitCode: number }) => {
      if (generation !== record.spawnGeneration) return
      record.live = null
      record.exitCode = exitCode
      deps.onLivePidsChanged()
      emitEvent(record, { type: 'exited', exitCode })
    })
  }

  const makeRecord = (input: TerminalOpenInput, cwd: string): TerminalRecord => ({
    key: terminalKeyOf(input.ownerKey, input.terminalId),
    ownerKey: input.ownerKey,
    terminalId: input.terminalId,
    cwd,
    scrollback: createTerminalScrollback(),
    sanitizer: createTerminalHistorySanitizer(),
    pendingOutput: '',
    pendingStartOffset: 0,
    outputBytes: 0,
    spawnGeneration: 0,
    exitCode: null,
    closed: false,
    live: null,
  })

  return {
    records,
    history,
    emitEvent,
    flushOutputs,
    killLive,
    spawn,
    makeRecord,
    discardPendingOutput: (key) => dirty.delete(key),
  }
}
