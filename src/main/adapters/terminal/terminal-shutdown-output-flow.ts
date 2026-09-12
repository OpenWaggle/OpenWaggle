import { TERMINAL } from '@shared/constants/resource-limits'
import type { LiveTerminalProcess, TerminalRecord } from './terminal-records'

export function restoreOutputFlow(record: TerminalRecord, wasPaused: boolean) {
  const live = record.live
  const backlogBytes = record.pendingOutputBytes + (record.inFlightOutput?.byteLength ?? 0)
  const shouldPause = wasPaused || backlogBytes >= TERMINAL.OUTPUT_BACKPRESSURE_HIGH_WATER_BYTES
  if (live === null || live.outputPaused === shouldPause) return
  if (shouldPause) live.pauseOutput()
  else live.resumeOutput()
  live.outputPaused = shouldPause
}

export function pauseOutputForShutdown(live: LiveTerminalProcess) {
  const wasPaused = live.outputPaused
  if (!wasPaused) {
    live.pauseOutput()
    live.outputPaused = true
  }
  return wasPaused
}
