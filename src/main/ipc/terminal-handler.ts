import { Buffer } from 'node:buffer'
import { TERMINAL } from '@shared/constants/resource-limits'
import { decodeUnknownOrThrow, Schema, safeDecodeUnknown } from '@shared/schema'
import type { TerminalOpenInput } from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { TerminalService } from '../ports/terminal-service'
import { runAppEffect } from '../runtime'
import { typedHandle, typedOn } from './typed-ipc'

const logger = createLogger('terminal-handler')

const MAX_TERMINAL_INPUT_BYTES = TERMINAL.MAX_INPUT_BYTES

const terminalOpenInputSchema = Schema.Struct({
  ownerKey: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(TERMINAL.OWNER_KEY_MAX_LENGTH),
  ),
  terminalId: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(TERMINAL.TERMINAL_ID_MAX_LENGTH),
  ),
  cwd: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(TERMINAL.CWD_PATH_MAX_LENGTH)),
  cols: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(TERMINAL.MIN_COLS),
    Schema.lessThanOrEqualTo(TERMINAL.MAX_COLS),
  ),
  rows: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(TERMINAL.MIN_ROWS),
    Schema.lessThanOrEqualTo(TERMINAL.MAX_ROWS),
  ),
})

const terminalResizeSchema = Schema.Struct({
  ownerKey: Schema.String.pipe(Schema.minLength(1)),
  terminalId: Schema.String.pipe(Schema.minLength(1)),
  cols: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(TERMINAL.MIN_COLS),
    Schema.lessThanOrEqualTo(TERMINAL.MAX_COLS),
  ),
  rows: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(TERMINAL.MIN_ROWS),
    Schema.lessThanOrEqualTo(TERMINAL.MAX_ROWS),
  ),
})

const terminalOwnerSchema = Schema.Struct({
  ownerKey: Schema.String.pipe(Schema.minLength(1)),
  terminalId: Schema.String.pipe(Schema.minLength(1)),
})

const terminalWriteSchema = Schema.String.pipe(
  Schema.maxLength(MAX_TERMINAL_INPUT_BYTES),
  // The cap is a wire-bytes cap: a 16k-char emoji paste is up to 64 KiB utf-8.
  Schema.filter((data) => Buffer.byteLength(data, 'utf8') <= MAX_TERMINAL_INPUT_BYTES, {
    message: () => 'Terminal input exceeds the byte limit.',
  }),
)

/**
 * Session-bound terminal transport (ADR 0030). Handlers decode, register the
 * calling window as the terminal's event surface, and delegate everything else
 * to the TerminalService.
 */
export function registerTerminalHandlers(): void {
  typedHandle('terminal:open', (event, input: TerminalOpenInput) =>
    Effect.gen(function* () {
      const decoded = yield* Effect.try(() => decodeUnknownOrThrow(terminalOpenInputSchema, input))
      const service = yield* TerminalService
      const result = yield* service.open(decoded)
      yield* service.attachSurface(
        terminalKeyOf(decoded.ownerKey, decoded.terminalId),
        event.sender.id,
      )
      return result
    }),
  )

  typedHandle('terminal:detach', (event, ownerKey: string, terminalId: string) =>
    Effect.gen(function* () {
      const decoded = yield* Effect.try(() =>
        decodeUnknownOrThrow(terminalOwnerSchema, { ownerKey, terminalId }),
      )
      const service = yield* TerminalService
      yield* service.detachTerminal(decoded.ownerKey, decoded.terminalId, event.sender.id)
    }),
  )

  typedHandle(
    'terminal:resize',
    (_event, ownerKey: string, terminalId: string, cols: number, rows: number) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.try(() =>
          decodeUnknownOrThrow(terminalResizeSchema, { ownerKey, terminalId, cols, rows }),
        )
        const service = yield* TerminalService
        yield* service.resize(decoded.ownerKey, decoded.terminalId, decoded.cols, decoded.rows)
      }),
  )

  typedHandle('terminal:clear', (_event, ownerKey: string, terminalId: string) =>
    Effect.gen(function* () {
      const decoded = yield* Effect.try(() =>
        decodeUnknownOrThrow(terminalOwnerSchema, { ownerKey, terminalId }),
      )
      const service = yield* TerminalService
      yield* service.clear(decoded.ownerKey, decoded.terminalId)
    }),
  )

  typedHandle('terminal:restart', (event, input: TerminalOpenInput) =>
    Effect.gen(function* () {
      const decoded = yield* Effect.try(() => decodeUnknownOrThrow(terminalOpenInputSchema, input))
      const service = yield* TerminalService
      const result = yield* service.restart(decoded)
      yield* service.attachSurface(
        terminalKeyOf(decoded.ownerKey, decoded.terminalId),
        event.sender.id,
      )
      return result
    }),
  )

  typedHandle(
    'terminal:close',
    (_event, ownerKey: string, terminalId: string, deleteHistory: boolean) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.try(() =>
          decodeUnknownOrThrow(terminalOwnerSchema, { ownerKey, terminalId }),
        )
        const service = yield* TerminalService
        yield* service.close(decoded.ownerKey, decoded.terminalId, deleteHistory === true)
      }),
  )

  typedOn('terminal:write', (_event, ownerKey: string, terminalId: string, data: string) =>
    Effect.gen(function* () {
      const parsed = safeDecodeUnknown(terminalWriteSchema, data)
      if (!parsed.success || parsed.data.length === 0) return
      const service = yield* TerminalService
      yield* service.write(ownerKey, terminalId, parsed.data)
    }),
  )
}

/** Kill every terminal; wired into app shutdown by the IPC module. */
export function cleanupTerminals(): Promise<void> {
  return runAppEffect(
    Effect.gen(function* () {
      const service = yield* TerminalService
      yield* service.closeAll()
    }),
  ).catch((error: unknown) => {
    logger.error('Terminal cleanup on shutdown failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
