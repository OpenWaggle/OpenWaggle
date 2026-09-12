import type {
  TerminalInputIdentity,
  TerminalInputIntent,
  TerminalWriteResult,
} from '@shared/types/terminal'
import { createTerminalInputDispatcher } from '../terminal-input-dispatcher'

export const READY = { phase: 'ready', generation: 1 } as const
export const AWAITING_PROMPT = { phase: 'awaiting-prompt', generation: 1 } as const

export type TerminalInputWriter = (
  ownerKey: string,
  terminalId: string,
  data: string,
  identity: TerminalInputIdentity,
  intent?: TerminalInputIntent,
) => Promise<TerminalWriteResult>

export function accepted(
  data: string,
  identity: TerminalInputIdentity,
  status: 'written' | 'queued' = 'written',
): TerminalWriteResult {
  return { status, acceptedBytes: new TextEncoder().encode(data).byteLength, identity }
}

export function deferredWriteResult() {
  let resolve: ((result: TerminalWriteResult) => void) | null = null
  const promise = new Promise<TerminalWriteResult>((resolvePromise) => {
    resolve = resolvePromise
  })
  return {
    promise,
    resolve(result: TerminalWriteResult) {
      resolve?.(result)
    },
  }
}

export function deferredText() {
  let resolveValue: (value: string) => void = () => undefined
  const promise = new Promise<string>((resolve) => {
    resolveValue = resolve
  })
  return { promise, resolve: resolveValue }
}

export function testDispatcher(
  writer: TerminalInputWriter,
  maxPendingBytes?: number,
  maxPendingOperations?: number,
) {
  let generation = 0
  return createTerminalInputDispatcher(writer, {
    createGeneration: () => {
      generation += 1
      return `input-generation-${generation}`
    },
    ...(maxPendingBytes === undefined ? {} : { maxPendingBytes }),
    ...(maxPendingOperations === undefined ? {} : { maxPendingOperations }),
  })
}
