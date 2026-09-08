import { Buffer } from 'node:buffer'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { TERMINAL } from '@shared/constants/resource-limits'
import { terminalKeyOf } from '@shared/types/terminal'
import type { TerminalEventPayload } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import { makeNodePtyTerminalService } from '../src/main/adapters/node-pty-terminal-service'
import type { TerminalEventSinkShape } from '../src/main/ports/terminal-event-sink'
import {
  runCloseUnderFloodGate,
  runRestartUnderFloodGate,
} from './benchmark-terminal-lifecycle'

/**
 * Terminal throughput benchmark (ADR 0030): drives the real node-pty service
 * against a live shell and measures attach latency, streamed throughput, and
 * IPC coalescing efficiency.
 *
 * Run: pnpm tsx scripts/benchmark-terminal-output.ts
 */

const OUTPUT_LINES = 200_000
const OWNER = 'benchmark-owner'
const TERMINAL_ID = 'term-bench'
const OUTPUT_LINE = '0123456789abcdef'
const OUTPUT_START_MARKER = '__OPENWAGGLE_BENCH_START__'
const OUTPUT_DONE_MARKER = '__OPENWAGGLE_BENCH_DONE__'
const OUTPUT_POLL_MS = 25
const OUTPUT_TIMEOUT_MS = 60_000
const FINAL_FLUSH_WINDOWS = 2
let benchmarkCompleted = false

process.once('beforeExit', () => {
  if (benchmarkCompleted) return
  process.stderr.write('benchmark failed: process exited before all terminal gates completed\n')
  process.exitCode = 1
})

function makeSink(): { readonly shape: TerminalEventSinkShape; readonly events: TerminalEventPayload[] } {
  const events: TerminalEventPayload[] = []
  const shape: TerminalEventSinkShape = {
    emit: (payload) =>
      Effect.sync(() => {
        events.push(payload)
        return 0
      }),
    attach: () => Effect.void,
    detach: () => Effect.succeed(false),
    move: () => Effect.void,
    detachSurface: () => Effect.succeed([]),
  }
  return { shape, events }
}

const BENCH_COLS = 120
const BENCH_ROWS = 30
const SETTLE_MS = 400
const BYTES_PER_MIB = 1024 * 1024
const MS_PER_SECOND = 1000

function outputForTerminal(events: readonly TerminalEventPayload[], terminalId: string) {
  return events
    .flatMap((payload) =>
      payload.terminalId === terminalId && payload.event.type === 'output'
        ? [payload.event.data]
        : [],
    )
    .join('')
}

function outputBytesForTerminal(events: readonly TerminalEventPayload[], terminalId: string) {
  let bytes = 0
  for (const payload of events) {
    if (payload.terminalId === terminalId && payload.event.type === 'output') {
      bytes += Buffer.byteLength(payload.event.data, 'utf8')
    }
  }
  return bytes
}

function outputEventCount(events: readonly TerminalEventPayload[]) {
  return events.filter((payload) => payload.event.type === 'output').length
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
    if (performance.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}.`)
    }
    await delay(OUTPUT_POLL_MS)
  }
}

function extractFloodLines(output: string) {
  const startMarkerOffset = output.indexOf(OUTPUT_START_MARKER)
  assertGate(startMarkerOffset >= 0, 'start marker is missing from PTY output')
  const payloadOffset = output.indexOf('\n', startMarkerOffset)
  assertGate(payloadOffset >= 0, 'start marker was not newline-terminated')
  const doneMarkerOffset = output.indexOf(OUTPUT_DONE_MARKER, payloadOffset + 1)
  assertGate(doneMarkerOffset >= 0, 'completion marker is missing from PTY output')
  const payload = output.slice(payloadOffset + 1, doneMarkerOffset).replaceAll('\r\n', '\n')
  const lines = payload.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function countLineFeeds(text: string) {
  let lines = 0
  for (const character of text) {
    if (character === '\n') lines += 1
  }
  return lines
}

function throughputCommand() {
  if (process.platform === 'win32') {
    throw new Error(
      'The main-process terminal benchmark command currently requires a POSIX shell. Renderer performance is gated separately in Electron QA.',
    )
  }
  // Encode underscores in the marker so the echoed command line cannot be
  // mistaken for the marker actually printed by the shell.
  const encodedStart = OUTPUT_START_MARKER.replaceAll('_', '\\137')
  const encodedDone = OUTPUT_DONE_MARKER.replaceAll('_', '\\137')
  return `printf '${encodedStart}\\n'; yes '${OUTPUT_LINE}' | head -n ${OUTPUT_LINES}; printf '${encodedDone}\\n'\n`
}

async function main(): Promise<void> {
  const logsDir = path.join(os.tmpdir(), `openwaggle-terminal-bench-${Date.now()}`)
  const { shape, events } = makeSink()
  const service = makeNodePtyTerminalService(shape, { logsDir, appVersion: '0.0.0-benchmark' })
  try {
    const openStarted = performance.now()
    const snapshot = await Effect.runPromise(
      service.open({
        ownerKey: OWNER,
        terminalId: TERMINAL_ID,
        cwd: process.cwd(),
        cols: BENCH_COLS,
        rows: BENCH_ROWS,
      }),
    )
    const attachMs = performance.now() - openStarted
    process.stdout.write(
      `attach: ${attachMs.toFixed(1)}ms (history ${Buffer.byteLength(snapshot.history, 'utf8')}B)\n`,
    )

    // This script gates the main-process PTY pipeline. Renderer long-task and
    // input-latency p95 belong in the real-Electron performance scenario.
    await delay(SETTLE_MS)
    events.length = 0

    const runStarted = performance.now()
    await Effect.runPromise(service.sendInputNow(OWNER, TERMINAL_ID))
    const writeResult = await Effect.runPromise(
      service.write(OWNER, TERMINAL_ID, throughputCommand()),
    )
    assertGate(writeResult.status !== 'rejected', `throughput command rejected (${writeResult.status})`)
    await waitUntil('the terminal throughput completion marker', () =>
      outputForTerminal(events, TERMINAL_ID).includes(OUTPUT_DONE_MARKER),
    )
    service.flushOutputs()
    await delay(TERMINAL.OUTPUT_FLUSH_MS * FINAL_FLUSH_WINDOWS)
    const runMs = performance.now() - runStarted

    const output = outputForTerminal(events, TERMINAL_ID)
    const floodLines = extractFloodLines(output)
    assertGate(
      floodLines.length === OUTPUT_LINES,
      `expected ${OUTPUT_LINES} output lines, received ${floodLines.length}`,
    )
    const corruptLineIndex = floodLines.findIndex((line) => line !== OUTPUT_LINE)
    assertGate(corruptLineIndex === -1, `output corruption at flood line ${corruptLineIndex + 1}`)

    const bytes = outputBytesForTerminal(events, TERMINAL_ID)
    assertGate(bytes === Buffer.byteLength(output, 'utf8'), 'UTF-8 byte accounting diverged')
    const emissions = outputEventCount(events)
    const mb = bytes / BYTES_PER_MIB
    process.stdout.write(
      `output: ${mb.toFixed(1)}MiB in ${runMs.toFixed(0)}ms (${((mb / runMs) * MS_PER_SECOND).toFixed(1)} MiB/s)\n`,
    )
    process.stdout.write(
      `coalescing: ${emissions} IPC events for ${OUTPUT_LINES} lines (${(OUTPUT_LINES / Math.max(emissions, 1)).toFixed(0)} lines/event)\n`,
    )

    await Effect.runPromise(service.close(OWNER, TERMINAL_ID, false))
    await service.history.flush()
    const history = await service.history.read(terminalKeyOf(OWNER, TERMINAL_ID))
    const persistedLines = countLineFeeds(history)
    const persistedBytes = Buffer.byteLength(history, 'utf8')
    assertGate(
      persistedLines > 0 && persistedLines <= TERMINAL.MAX_SCROLLBACK_LINES,
      `persisted ${persistedLines} lines outside the 1-${TERMINAL.MAX_SCROLLBACK_LINES} bounded range`,
    )
    assertGate(
      persistedBytes <= TERMINAL.MAX_SCROLLBACK_BYTES,
      `persisted ${persistedBytes} bytes above the ${TERMINAL.MAX_SCROLLBACK_BYTES}-byte cap`,
    )
    process.stdout.write(
      `persisted scrollback: ${persistedLines} lines, ${persistedBytes} bytes (caps enforced)\n`,
    )

    const lifecycleContext = {
      cols: BENCH_COLS,
      cwd: process.cwd(),
      events,
      ownerKey: OWNER,
      rows: BENCH_ROWS,
      service,
    }
    await runCloseUnderFloodGate(lifecycleContext)
    await runRestartUnderFloodGate(lifecycleContext)

  } finally {
    try {
      await Effect.runPromise(service.closeAll())
    } finally {
      await rm(logsDir, { recursive: true, force: true })
    }
  }
  process.stdout.write('benchmark gates passed\n')
  benchmarkCompleted = true
}

void main().catch((error: unknown) => {
  process.stderr.write(`benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
