import { Buffer } from 'node:buffer'
import { performance } from 'node:perf_hooks'
import { TERMINAL } from '@shared/constants/resource-limits'
import { terminalKeyOf } from '@shared/types/terminal'
import type { TerminalEventPayload } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import type { TerminalServiceInternals } from '../src/main/adapters/node-pty-terminal-service'
import type { TerminalServiceShape } from '../src/main/ports/terminal-service'

const OUTPUT_LINES = 200_000
const OUTPUT_LINE = '0123456789abcdef'
const FLOOD_CLOSE_TERMINAL_ID = 'term-close-under-flood'
const FLOOD_RESTART_TERMINAL_ID = 'term-restart-under-flood'
const FLOOD_PID_MARKER = '__OPENWAGGLE_FLOOD_PID__'
const REPLACEMENT_READY_MARKER = '__OPENWAGGLE_RESTART_READY__'
const OUTPUT_POLL_MS = 25
const OUTPUT_TIMEOUT_MS = 60_000
const LIFECYCLE_UNDER_FLOOD_MAX_MS = 250
const FLOOD_STARTED_BYTES = TERMINAL.OUTPUT_BACKPRESSURE_HIGH_WATER_BYTES
const FINAL_FLUSH_WINDOWS = 2
const SETTLE_MS = 400

type BenchmarkTerminalService = TerminalServiceShape & TerminalServiceInternals

export interface TerminalLifecycleBenchmarkContext {
  readonly cols: number
  readonly cwd: string
  readonly events: TerminalEventPayload[]
  readonly ownerKey: string
  readonly rows: number
  readonly service: BenchmarkTerminalService
}

function assertGate(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Terminal benchmark gate failed: ${message}`)
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function waitUntil(description: string, predicate: () => boolean) {
  const deadline = performance.now() + OUTPUT_TIMEOUT_MS
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(`Timed out waiting for ${description}.`)
    await delay(OUTPUT_POLL_MS)
  }
}

function outputForTerminal(events: readonly TerminalEventPayload[], terminalId: string) {
  return events
    .flatMap((payload) =>
      payload.terminalId === terminalId && payload.event.type === 'output'
        ? [payload.event.data]
        : [],
    )
    .join('')
}

function outputForGeneration(
  events: readonly TerminalEventPayload[],
  terminalId: string,
  outputGeneration: number,
) {
  return events
    .flatMap((payload) =>
      payload.terminalId === terminalId &&
      payload.event.type === 'output' &&
      payload.event.outputGeneration === outputGeneration
        ? [payload.event.data]
        : [],
    )
    .join('')
}

function floodCommand() {
  const encodedPidMarker = FLOOD_PID_MARKER.replaceAll('_', '\\137')
  return `yes '${OUTPUT_LINE}' & flood_pid=$!; printf '${encodedPidMarker}%s\\n' "$flood_pid"; wait "$flood_pid"\n`
}

function replacementReadyCommand() {
  const encodedMarker = REPLACEMENT_READY_MARKER.replaceAll('_', '\\137')
  return `printf '${encodedMarker}\\n'\n`
}

function extractFloodPid(output: string) {
  const match = output.match(new RegExp(`${FLOOD_PID_MARKER}(\\d+)`))
  const pid = Number(match?.[1])
  assertGate(Number.isInteger(pid) && pid > 0, 'active flood child pid marker is missing')
  return pid
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

async function openFloodTerminal(
  context: TerminalLifecycleBenchmarkContext,
  terminalId: string,
) {
  context.events.length = 0
  await Effect.runPromise(
    context.service.open({
      ownerKey: context.ownerKey,
      terminalId,
      cwd: context.cwd,
      cols: context.cols,
      rows: context.rows,
    }),
  )
  await delay(SETTLE_MS)
  context.events.length = 0
  await Effect.runPromise(context.service.sendInputNow(context.ownerKey, terminalId))
}

export async function runCloseUnderFloodGate(context: TerminalLifecycleBenchmarkContext) {
  await openFloodTerminal(context, FLOOD_CLOSE_TERMINAL_ID)
  const write = await Effect.runPromise(
    context.service.write(context.ownerKey, FLOOD_CLOSE_TERMINAL_ID, floodCommand()),
  )
  assertGate(write.status !== 'rejected', 'unbounded close flood command was rejected')
  await waitUntil('active output flood before close', () => {
    const output = outputForTerminal(context.events, FLOOD_CLOSE_TERMINAL_ID)
    return (
      Buffer.byteLength(output, 'utf8') >= FLOOD_STARTED_BYTES &&
      output.includes(FLOOD_PID_MARKER)
    )
  })
  const floodPid = extractFloodPid(outputForTerminal(context.events, FLOOD_CLOSE_TERMINAL_ID))
  const startedAt = performance.now()
  await Effect.runPromise(
    context.service.close(context.ownerKey, FLOOD_CLOSE_TERMINAL_ID, false),
  )
  const elapsedMs = performance.now() - startedAt
  assertGate(
    elapsedMs <= LIFECYCLE_UNDER_FLOOD_MAX_MS,
    `close under flood took ${elapsedMs.toFixed(1)}ms (max ${LIFECYCLE_UNDER_FLOOD_MAX_MS}ms)`,
  )
  assertGate(!isProcessAlive(floodPid), `flood child process ${floodPid} survived close`)
  process.stdout.write(
    `close under flood: ${elapsedMs.toFixed(1)}ms (gate ${LIFECYCLE_UNDER_FLOOD_MAX_MS}ms)\n`,
  )
}

function makeActiveFloodProgress(events: readonly TerminalEventPayload[]) {
  let eventIndex = 0
  let lineBuffer = ''
  let floodLines = 0
  let floodPid: number | null = null
  const read = () => {
    while (eventIndex < events.length) {
      const payload = events[eventIndex]
      eventIndex += 1
      if (payload?.terminalId !== FLOOD_RESTART_TERMINAL_ID || payload.event.type !== 'output') {
        continue
      }
      const lines = `${lineBuffer}${payload.event.data}`.split('\n')
      lineBuffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        if (line === OUTPUT_LINE) floodLines += 1
        if (floodPid !== null) continue
        const match = line.match(new RegExp(`${FLOOD_PID_MARKER}(\\d+)`))
        const parsed = Number(match?.[1])
        if (Number.isInteger(parsed) && parsed > 0) floodPid = parsed
      }
    }
    return { floodLines, floodPid }
  }
  return { read }
}

async function startRestartFlood(context: TerminalLifecycleBenchmarkContext) {
  await openFloodTerminal(context, FLOOD_RESTART_TERMINAL_ID)
  const progress = makeActiveFloodProgress(context.events)
  const write = await Effect.runPromise(
    context.service.write(context.ownerKey, FLOOD_RESTART_TERMINAL_ID, floodCommand()),
  )
  assertGate(write.status !== 'rejected', 'restart flood command was rejected')
  await waitUntil(`an active ${OUTPUT_LINES}-line output flood before restart`, () => {
    const snapshot = progress.read()
    return snapshot.floodLines >= OUTPUT_LINES && snapshot.floodPid !== null
  })
  const snapshot = progress.read()
  assertGate(snapshot.floodPid !== null, 'restart flood child pid marker is missing')
  assertGate(
    isProcessAlive(snapshot.floodPid),
    `restart flood child process ${snapshot.floodPid} exited before restart`,
  )
  const output = context.events.findLast(
    (payload) =>
      payload.terminalId === FLOOD_RESTART_TERMINAL_ID && payload.event.type === 'output',
  )
  assertGate(output?.event.type === 'output', 'restart flood emitted no output generation')
  return {
    eventIndex: context.events.length,
    floodLines: snapshot.floodLines,
    floodPid: snapshot.floodPid,
    outputGeneration: output.event.outputGeneration,
  }
}

function assertReplacementIntegrity(
  events: readonly TerminalEventPayload[],
  replacementGeneration: number,
  invokedEventIndex: number,
  completedEventIndex: number,
) {
  const outputs = events.flatMap((payload, index) =>
    payload.terminalId === FLOOD_RESTART_TERMINAL_ID && payload.event.type === 'output'
      ? [{ event: payload.event, index }]
      : [],
  )
  const firstReplacement = outputs.findIndex(
    ({ event }) => event.outputGeneration === replacementGeneration,
  )
  assertGate(firstReplacement >= 0, 'replacement shell emitted no output events')
  const stale = outputs.filter(
    ({ event, index }, outputIndex) =>
      event.outputGeneration !== replacementGeneration &&
      (index >= completedEventIndex ||
        (index >= invokedEventIndex && outputIndex >= firstReplacement)),
  )
  assertGate(stale.length === 0, 'old-generation output crossed the replacement boundary')

  const replacement = outputs.flatMap(({ event }) =>
    event.outputGeneration === replacementGeneration ? [event] : [],
  )
  let expectedStartOffset = 0
  for (const event of replacement) {
    assertGate(
      event.startOffset === expectedStartOffset,
      `replacement output offset jumped from ${expectedStartOffset} to ${event.startOffset}`,
    )
    assertGate(
      event.endOffset - event.startOffset === Buffer.byteLength(event.data, 'utf8'),
      'replacement output byte offsets do not match its UTF-8 payload',
    )
    expectedStartOffset = event.endOffset
  }
  const output = replacement.map((event) => event.data).join('')
  assertGate(
    output.split(REPLACEMENT_READY_MARKER).length - 1 === 1,
    'replacement usability marker was missing or duplicated',
  )
  const staleFloodLines = output
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => line === OUTPUT_LINE)
  assertGate(staleFloodLines.length === 0, 'stale flood payload contaminated replacement output')
}

export async function runRestartUnderFloodGate(context: TerminalLifecycleBenchmarkContext) {
  const flood = await startRestartFlood(context)
  const startedAt = performance.now()
  const snapshot = await Effect.runPromise(
    context.service.restart({
      ownerKey: context.ownerKey,
      terminalId: FLOOD_RESTART_TERMINAL_ID,
      cwd: context.cwd,
      cols: context.cols,
      rows: context.rows,
    }),
  )
  const elapsedMs = performance.now() - startedAt
  const completedEventIndex = context.events.length
  assertGate(
    elapsedMs <= LIFECYCLE_UNDER_FLOOD_MAX_MS,
    `restart under flood took ${elapsedMs.toFixed(1)}ms (max ${LIFECYCLE_UNDER_FLOOD_MAX_MS}ms)`,
  )
  assertGate(snapshot.running, 'restart did not request a replacement shell')
  assertGate(snapshot.outputBytes === 0, 'replacement output stream did not reset to zero')
  assertGate(snapshot.history.length === 0, 'replacement shell replayed stale flood history')
  assertGate(
    snapshot.outputGeneration > flood.outputGeneration,
    `restart kept stale output generation ${flood.outputGeneration}`,
  )
  assertGate(!isProcessAlive(flood.floodPid), `flood child process ${flood.floodPid} survived restart`)

  const key = terminalKeyOf(context.ownerKey, FLOOD_RESTART_TERMINAL_ID)
  await waitUntil('the replacement shell to attach after restart', () => {
    return context.service.records.get(key)?.live !== null
  })
  const release = await Effect.runPromise(
    context.service.sendInputNow(context.ownerKey, FLOOD_RESTART_TERMINAL_ID),
  )
  assertGate(release.status !== 'terminal-not-open', 'replacement shell could not accept input')
  const write = await Effect.runPromise(
    context.service.write(context.ownerKey, FLOOD_RESTART_TERMINAL_ID, replacementReadyCommand()),
  )
  assertGate(write.status !== 'rejected', 'replacement shell rejected input')
  await waitUntil('replacement shell usability marker', () =>
    outputForGeneration(
      context.events,
      FLOOD_RESTART_TERMINAL_ID,
      snapshot.outputGeneration,
    ).includes(REPLACEMENT_READY_MARKER),
  )
  context.service.flushOutputs()
  await delay(TERMINAL.OUTPUT_FLUSH_MS * FINAL_FLUSH_WINDOWS)
  assertReplacementIntegrity(
    context.events,
    snapshot.outputGeneration,
    flood.eventIndex,
    completedEventIndex,
  )
  process.stdout.write(
    `restart under active ${flood.floodLines}-line flood: ${elapsedMs.toFixed(1)}ms ` +
      `(gate ${LIFECYCLE_UNDER_FLOOD_MAX_MS}ms; replacement usable)\n`,
  )
}
