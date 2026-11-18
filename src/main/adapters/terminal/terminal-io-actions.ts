import { terminalKeyOf } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import { resolveTerminalKey, type TerminalActionContext } from './terminal-service-actions'

const logger = createLogger('terminal-io-actions')

export function acknowledgeTerminalOutputAction(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
  outputGeneration: number,
  endOffset: number,
) {
  return Effect.sync(() => {
    const key = resolveTerminalKey(context, terminalKeyOf(ownerKey, terminalId))
    const record = context.runtime.records.get(key)
    if (record === undefined) return
    context.runtime.acknowledgeOutput(record, outputGeneration, endOffset)
  })
}

export function resizeTerminalAction(
  context: TerminalActionContext,
  ownerKey: string,
  terminalId: string,
  cols: number,
  rows: number,
) {
  return Effect.sync(() => {
    try {
      const key = resolveTerminalKey(context, terminalKeyOf(ownerKey, terminalId))
      context.runtime.records.get(key)?.live?.pty.resize(cols, rows)
    } catch (error) {
      logger.debug('Terminal resize ignored', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
