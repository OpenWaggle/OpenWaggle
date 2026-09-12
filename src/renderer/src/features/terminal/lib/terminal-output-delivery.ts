import type { TerminalAttachResult, TerminalRuntimeEvent } from '@shared/types/terminal'
import type { Terminal } from '@xterm/xterm'
import { sliceTerminalDataAfterBytes } from './terminal-input'
import { writeTerminalOutput } from './write-terminal-output'

type OutputEvent = Extract<TerminalRuntimeEvent, { type: 'output' }>

interface TerminalOutputDeliveryOptions {
  readonly ownerKey: string
  readonly terminalId: string
  readonly terminal: Terminal
  readonly acknowledge: (
    ownerKey: string,
    terminalId: string,
    outputGeneration: number,
    endOffset: number,
  ) => void
}

/**
 * Orders attach snapshots and live output using exact byte offsets, then ACKs
 * each event only after xterm has consumed it. This state stays local to the
 * viewport because main replays any unacknowledged bytes on the next attach.
 */
export function createTerminalOutputDelivery(options: TerminalOutputDeliveryOptions) {
  let snapshotOutputBytes: number | null = null
  let outputGeneration: number | null = null
  const bufferedOutput: OutputEvent[] = []
  const pendingOutputAcks = new Map<string, OutputEvent>()

  const acknowledge = (event: OutputEvent) => {
    pendingOutputAcks.delete(`${event.outputGeneration}:${event.endOffset}`)
    options.acknowledge(
      options.ownerKey,
      options.terminalId,
      event.outputGeneration,
      event.endOffset,
    )
  }

  const write = (event: OutputEvent) => {
    pendingOutputAcks.set(`${event.outputGeneration}:${event.endOffset}`, event)
    if (snapshotOutputBytes === null || outputGeneration === null) {
      bufferedOutput.push(event)
      return
    }
    if (event.outputGeneration !== outputGeneration) {
      acknowledge(event)
      return
    }
    const eventBytes = event.endOffset - event.startOffset
    const skippedBytes = Math.min(Math.max(snapshotOutputBytes - event.startOffset, 0), eventBytes)
    const suffix = sliceTerminalDataAfterBytes(event.data, skippedBytes)
    if (suffix.length === 0) {
      acknowledge(event)
      return
    }
    writeTerminalOutput(options.terminal, suffix, () => acknowledge(event))
  }

  const acknowledgePending = () => {
    for (const event of pendingOutputAcks.values()) acknowledge(event)
    pendingOutputAcks.clear()
  }

  const applySnapshot = (snapshot: TerminalAttachResult) => {
    snapshotOutputBytes = snapshot.outputBytes
    outputGeneration = snapshot.outputGeneration
    if (snapshot.history.length > 0) writeTerminalOutput(options.terminal, snapshot.history)
    for (const buffered of bufferedOutput) write(buffered)
    bufferedOutput.length = 0
  }

  const clear = (generation: number) => {
    acknowledgePending()
    snapshotOutputBytes = 0
    outputGeneration = generation
    bufferedOutput.length = 0
  }

  const reset = () => {
    acknowledgePending()
    const previous = { snapshotOutputBytes, outputGeneration }
    snapshotOutputBytes = null
    outputGeneration = null
    return () => {
      snapshotOutputBytes = previous.snapshotOutputBytes
      outputGeneration = previous.outputGeneration
      const pending = bufferedOutput.splice(0)
      for (const event of pending) write(event)
    }
  }

  return { acknowledgePending, applySnapshot, clear, reset, write }
}
