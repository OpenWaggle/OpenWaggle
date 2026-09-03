import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { terminalKeyOf } from '@shared/types/terminal'
import type { TerminalEventPayload } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import { makeNodePtyTerminalService } from '../src/main/adapters/node-pty-terminal-service'
import type { TerminalEventSinkShape } from '../src/main/ports/terminal-event-sink'

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
const DRAIN_POLL_MS = 400

function makeSink(): { readonly shape: TerminalEventSinkShape; readonly events: TerminalEventPayload[] } {
  const events: TerminalEventPayload[] = []
  const shape: TerminalEventSinkShape = {
    emit: (payload) =>
      Effect.sync(() => {
        events.push(payload)
      }),
    attach: () => Effect.void,
    detach: () => Effect.void,
    detachSurface: () => Effect.void,
  }
  return { shape, events }
}

const BENCH_COLS = 120
const BENCH_ROWS = 30
const SETTLE_MS = 400
const BYTES_PER_MIB = 1024 * 1024
const MS_PER_SECOND = 1000

function totalOutputBytes(events: readonly TerminalEventPayload[]) {
  let bytes = 0
  for (const payload of events) {
    if (payload.event.type === 'output') bytes += payload.event.data.length
  }
  return bytes
}

function outputEventCount(events: readonly TerminalEventPayload[]) {
  return events.filter((payload) => payload.event.type === 'output').length
}

async function main(): Promise<void> {
  const logsDir = path.join(os.tmpdir(), `openwaggle-terminal-bench-${Date.now()}`)
  const { shape, events } = makeSink()
  const service = makeNodePtyTerminalService(shape, { logsDir })

  const openStarted = performance.now()
  const snapshot = await Effect.runPromise(
    service.open({ ownerKey: OWNER, terminalId: TERMINAL_ID, cwd: process.cwd(), cols: BENCH_COLS, rows: BENCH_ROWS }),
  )
  const attachMs = performance.now() - openStarted
  process.stdout.write(`attach: ${attachMs.toFixed(1)}ms (history ${snapshot.history.length}B)\n`)

  // Let the shell prompt settle before flooding output.
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  events.length = 0

  const runStarted = performance.now()
  await Effect.runPromise(service.write(OWNER, TERMINAL_ID, `yes '0123456789abcdef' | head -n ${OUTPUT_LINES}\n`))

  // Drain detection: stop once output stalls between polls.
  let lastBytes = -1
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS))
    const bytes = totalOutputBytes(events)
    if (bytes === lastBytes) break
    lastBytes = bytes
  }
  const runMs = performance.now() - runStarted

  const bytes = totalOutputBytes(events)
  const emissions = outputEventCount(events)
  const mb = bytes / BYTES_PER_MIB
  process.stdout.write(
    `output: ${mb.toFixed(1)}MiB in ${runMs.toFixed(0)}ms (${((mb / runMs) * MS_PER_SECOND).toFixed(1)} MiB/s)\n`,
  )
  process.stdout.write(
    `coalescing: ${emissions} IPC events for ${OUTPUT_LINES} lines (${(OUTPUT_LINES / Math.max(emissions, 1)).toFixed(0)} lines/event)\n`,
  )

  await Effect.runPromise(service.closeAll())
  // closeAll flushes the final coalesced appends before the read.
  const history = await service.history.read(terminalKeyOf(OWNER, TERMINAL_ID))
  process.stdout.write(`persisted scrollback: ${history.split('\n').length} lines (cap 5000)\n`)

  process.stdout.write('benchmark complete\n')
}

void main().catch((error: unknown) => {
  process.stderr.write(`benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})