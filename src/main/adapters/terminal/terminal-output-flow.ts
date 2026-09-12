import { Buffer } from 'node:buffer'
import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalId, TerminalKey, TerminalRuntimeEvent } from '@shared/types/terminal'
import type { TerminalRecord } from './terminal-records'

const UTF8_ONE_BYTE_MAX = 0x7f
const UTF8_TWO_BYTE_MAX = 0x7ff
const UTF8_THREE_BYTE_MAX = 0xffff
const UTF8_ONE_BYTE = 1
const UTF8_TWO_BYTES = 2
const UTF8_THREE_BYTES = 3
const UTF8_FOUR_BYTES = 4
const UTF16_SURROGATE_PAIR_UNITS = 2

interface TerminalOutputFlowDeps {
  readonly records: Map<string, TerminalRecord>
  readonly emit: (payload: {
    readonly ownerKey: string
    readonly terminalId: TerminalId
    readonly event: TerminalRuntimeEvent
  }) => number | Promise<number>
  readonly onOutputDrained: (record: TerminalRecord) => void
}

export interface TerminalOutputFlow {
  readonly append: (record: TerminalRecord, data: string) => void
  readonly acknowledge: (
    record: TerminalRecord,
    outputGeneration: number,
    endOffset: number,
  ) => void
  /** Release an in-flight chunk already covered by a replacement surface snapshot. */
  readonly reconcileSnapshot: (
    record: TerminalRecord,
    outputGeneration: number,
    outputBytes: number,
  ) => void
  readonly beginGeneration: (record: TerminalRecord) => void
  readonly resetStream: (record: TerminalRecord) => void
  readonly discard: (key: TerminalKey) => void
  readonly rekey: (oldKey: TerminalKey, newKey: TerminalKey) => void
  readonly flush: () => void
  readonly backlogBytes: (record: TerminalRecord) => number
}

function utf8PrefixAtMost(data: string, maxBytes: number) {
  if (Buffer.byteLength(data, 'utf8') <= maxBytes) return data
  let bytes = 0
  let end = 0
  while (end < data.length) {
    const codePoint = data.codePointAt(end)
    if (codePoint === undefined) break
    const codePointBytes = utf8CodePointBytes(codePoint)
    if (bytes + codePointBytes > maxBytes) break
    bytes += codePointBytes
    end += codePoint > UTF8_THREE_BYTE_MAX ? UTF16_SURROGATE_PAIR_UNITS : UTF8_ONE_BYTE
  }
  return data.slice(0, end)
}

function utf8CodePointBytes(codePoint: number) {
  if (codePoint <= UTF8_ONE_BYTE_MAX) return UTF8_ONE_BYTE
  if (codePoint <= UTF8_TWO_BYTE_MAX) return UTF8_TWO_BYTES
  if (codePoint <= UTF8_THREE_BYTE_MAX) return UTF8_THREE_BYTES
  return UTF8_FOUR_BYTES
}

function makeOutputBackpressure() {
  const backlogBytes = (record: TerminalRecord) =>
    record.pendingOutputBytes + (record.inFlightOutput?.byteLength ?? 0)

  const pause = (record: TerminalRecord) => {
    const live = record.live
    if (
      live === null ||
      live.outputPaused ||
      record.termination !== null ||
      backlogBytes(record) < TERMINAL.OUTPUT_BACKPRESSURE_HIGH_WATER_BYTES
    ) {
      return
    }
    live.pauseOutput()
    live.outputPaused = true
  }

  const resume = (record: TerminalRecord) => {
    const live = record.live
    if (
      live === null ||
      !live.outputPaused ||
      record.ownerMigration !== null ||
      backlogBytes(record) > TERMINAL.OUTPUT_BACKPRESSURE_LOW_WATER_BYTES
    ) {
      return
    }
    live.resumeOutput()
    live.outputPaused = false
  }

  return { backlogBytes, pause, resume }
}

function makeOutputScheduler(flush: () => void) {
  let flushTimer: NodeJS.Timeout | null = null
  let immediateFlushPending = false

  return {
    schedule() {
      if (flushTimer !== null) return
      flushTimer = setTimeout(flush, TERMINAL.OUTPUT_FLUSH_MS)
      flushTimer.unref?.()
    },
    scheduleImmediate() {
      if (immediateFlushPending) return
      immediateFlushPending = true
      queueMicrotask(() => {
        immediateFlushPending = false
        flush()
      })
    },
    clearTimer() {
      if (flushTimer === null) return
      clearTimeout(flushTimer)
      flushTimer = null
    },
  }
}

function dispatchOutput(
  deps: TerminalOutputFlowDeps,
  record: TerminalRecord,
  acknowledge: (record: TerminalRecord, outputGeneration: number, endOffset: number) => void,
) {
  const data = utf8PrefixAtMost(record.pendingOutput, TERMINAL.OUTPUT_DELIVERY_CHUNK_BYTES)
  if (data.length === 0) return
  const byteLength = Buffer.byteLength(data, 'utf8')
  const startOffset = record.pendingStartOffset
  const endOffset = startOffset + byteLength
  record.pendingOutput = record.pendingOutput.slice(data.length)
  record.pendingOutputBytes -= byteLength
  record.pendingStartOffset = endOffset
  const event = {
    type: 'output',
    data,
    outputGeneration: record.outputGeneration,
    startOffset,
    endOffset,
  } satisfies Extract<TerminalRuntimeEvent, { type: 'output' }>
  record.inFlightOutput = { event, byteLength }
  void Promise.resolve(
    deps.emit({ ownerKey: record.ownerKey, terminalId: record.terminalId, event }),
  )
    .then((deliveryCount) => {
      if (deliveryCount === 0) acknowledge(record, event.outputGeneration, event.endOffset)
    })
    .catch(() => {
      acknowledge(record, event.outputGeneration, event.endOffset)
    })
}

export function makeTerminalOutputFlow(deps: TerminalOutputFlowDeps): TerminalOutputFlow {
  const dirty = new Set<TerminalKey>()
  const backpressure = makeOutputBackpressure()
  const scheduler = makeOutputScheduler(flush)

  const acknowledge = (record: TerminalRecord, outputGeneration: number, endOffset: number) => {
    const delivery = record.inFlightOutput
    if (
      delivery === null ||
      delivery.event.outputGeneration !== outputGeneration ||
      delivery.event.endOffset !== endOffset
    ) {
      return
    }
    record.inFlightOutput = null
    backpressure.resume(record)
    if (record.pendingOutput.length > 0) {
      dirty.add(record.key)
      scheduler.scheduleImmediate()
      return
    }
    if (record.pendingOutputBytes === 0) deps.onOutputDrained(record)
  }

  function flush() {
    scheduler.clearTimer()
    if (dirty.size === 0) return
    const keys = [...dirty]
    dirty.clear()
    for (const key of keys) {
      const record = deps.records.get(key)
      if (
        record === undefined ||
        record.closed ||
        record.pendingOutput.length === 0 ||
        record.inFlightOutput !== null
      ) {
        continue
      }
      dispatchOutput(deps, record, acknowledge)
    }
  }

  const append = (record: TerminalRecord, data: string) => {
    if (record.pendingOutput.length === 0) record.pendingStartOffset = record.outputBytes
    const dataByteLength = Buffer.byteLength(data, 'utf8')
    record.pendingOutput += data
    record.pendingOutputBytes += dataByteLength
    record.outputBytes += dataByteLength
    dirty.add(record.key)
    backpressure.pause(record)
    scheduler.schedule()
  }

  const beginGeneration = (record: TerminalRecord) => {
    if (record.live?.outputPaused === true) {
      record.live.resumeOutput()
      record.live.outputPaused = false
    }
    record.outputGeneration += 1
    record.pendingOutput = ''
    record.pendingOutputBytes = 0
    record.pendingStartOffset = record.outputBytes
    record.inFlightOutput = null
    dirty.delete(record.key)
  }

  return {
    append,
    acknowledge,
    reconcileSnapshot: (record, outputGeneration, outputBytes) => {
      const delivery = record.inFlightOutput
      if (
        delivery === null ||
        delivery.event.outputGeneration !== outputGeneration ||
        delivery.event.endOffset > outputBytes
      ) {
        return
      }
      acknowledge(record, outputGeneration, delivery.event.endOffset)
    },
    beginGeneration,
    resetStream: (record) => {
      record.outputBytes = 0
      beginGeneration(record)
      record.pendingStartOffset = 0
    },
    discard: (key) => {
      dirty.delete(key)
      const record = deps.records.get(key)
      if (record === undefined) return
      record.pendingOutput = ''
      record.pendingOutputBytes = 0
      record.inFlightOutput = null
      backpressure.resume(record)
    },
    rekey: (oldKey, newKey) => {
      if (!dirty.delete(oldKey)) return
      dirty.add(newKey)
      scheduler.scheduleImmediate()
    },
    flush,
    backlogBytes: backpressure.backlogBytes,
  }
}
