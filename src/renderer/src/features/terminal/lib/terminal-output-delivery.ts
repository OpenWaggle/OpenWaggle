import type { TerminalAttachResult, TerminalRuntimeEvent } from '@shared/types/terminal'
import { stripTerminalQuerySequences } from '@shared/utils/terminal-escape-sequences'
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
 *
 * Attach history is a replay, not live output (issue #385). It is scrubbed of
 * terminal queries before xterm sees it, and `isReplaying()` stays true from
 * the moment it is queued until xterm has parsed its last slice. xterm parses
 * its write queue in order and runs a write's callback right after parsing
 * it, before the next write, so live output queued behind the replay is
 * parsed, and its queries answered, only after the replay window closed.
 */
export function createTerminalOutputDelivery(options: TerminalOutputDeliveryOptions) {
  let snapshotOutputBytes: number | null = null
  let outputGeneration: number | null = null
  const bufferedOutput: OutputEvent[] = []
  const pendingOutputAcks = new Map<string, OutputEvent>()
  let replaysInFlight = 0

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
    const history = stripTerminalQuerySequences(snapshot.history)
    if (history.length > 0) {
      replaysInFlight += 1
      writeTerminalOutput(options.terminal, history, () => {
        replaysInFlight -= 1
      })
    }
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

  /** Whether xterm may still be parsing replayed history, so its reports are not live answers. */
  const isReplaying = () => replaysInFlight > 0

  return { acknowledgePending, applySnapshot, clear, isReplaying, reset, write }
}
