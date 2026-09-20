import { Buffer } from 'node:buffer'
import { TERMINAL } from '@shared/constants/resource-limits'
import { decodeUnknownOrThrow, safeDecodeUnknown } from '@shared/schema'
import type {
  TerminalInputIdentity,
  TerminalInputIntent,
  TerminalOpenInput,
} from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { TerminalService, type TerminalServiceShape } from '../ports/terminal-service'
import { runAppEffect } from '../runtime'
import {
  terminalInputIdentitySchema,
  terminalInputIntentSchema,
  terminalInputReleaseSchema,
  terminalOpenInputSchema,
  terminalOutputAckSchema,
  terminalOwnerMigrationSchema,
  terminalOwnerSchema,
  terminalResizeSchema,
  terminalWriteSchema,
} from './terminal-handler-schemas'
import { typedHandle, typedOn } from './typed-ipc'

const logger = createLogger('terminal-handler')

const registeredTerminalSurfaces = new WeakSet<object>()

function registerTerminalSurfaceLifecycle(sender: object, service: TerminalServiceShape) {
  if (registeredTerminalSurfaces.has(sender)) return
  const on: unknown = Reflect.get(sender, 'on')
  if (typeof on !== 'function') return
  registeredTerminalSurfaces.add(sender)
  const surfaceId: unknown = Reflect.get(sender, 'id')
  if (typeof surfaceId !== 'number') return
  const detach = () => {
    void Effect.runPromise(service.detachSurface(surfaceId)).catch((error: unknown) => {
      logger.warn('Terminal surface cleanup failed', {
        surfaceId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
  Reflect.apply(on, sender, ['did-start-loading', detach])
  Reflect.apply(on, sender, ['render-process-gone', detach])
  Reflect.apply(on, sender, ['destroyed', detach])
}

/**
 * Session-bound terminal transport (ADR 0030). Handlers decode, register the
 * calling window as the terminal's event surface, and delegate everything else
 * to the TerminalService.
 */
export function registerTerminalHandlers(): void {
  registerTerminalLifecycleHandlers()
  registerTerminalStreamHandlers()
}

function registerTerminalLifecycleHandlers() {
  typedHandle('terminal:get-activity-snapshot', () =>
    Effect.gen(function* () {
      const service = yield* TerminalService
      return yield* service.getActivitySnapshot()
    }),
  )

  typedHandle('terminal:open', (event, input: TerminalOpenInput) =>
    Effect.gen(function* () {
      const decoded = yield* Effect.try(() => decodeUnknownOrThrow(terminalOpenInputSchema, input))
      const service = yield* TerminalService
      registerTerminalSurfaceLifecycle(event.sender, service)
      yield* service.attachSurface(
        terminalKeyOf(decoded.ownerKey, decoded.terminalId),
        event.sender.id,
      )
      return yield* service.open(decoded)
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
      registerTerminalSurfaceLifecycle(event.sender, service)
      yield* service.attachSurface(
        terminalKeyOf(decoded.ownerKey, decoded.terminalId),
        event.sender.id,
      )
      return yield* service.restart(decoded)
    }),
  )

  typedHandle('terminal:assess-close', (_event, ownerKey: string, terminalId: string) =>
    Effect.gen(function* () {
      const decoded = yield* Effect.try(() =>
        decodeUnknownOrThrow(terminalOwnerSchema, { ownerKey, terminalId }),
      )
      const service = yield* TerminalService
      return yield* service.assessClose(decoded.ownerKey, decoded.terminalId)
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
}

function registerTerminalStreamHandlers() {
  typedHandle(
    'terminal:write',
    (
      _event,
      ownerKey: string,
      terminalId: string,
      data: string,
      identity?: TerminalInputIdentity,
      intent?: TerminalInputIntent,
    ) =>
      Effect.gen(function* () {
        const owner = yield* Effect.try(() =>
          decodeUnknownOrThrow(terminalOwnerSchema, { ownerKey, terminalId }),
        )
        const decodedIdentity =
          identity === undefined
            ? undefined
            : yield* Effect.try(() => decodeUnknownOrThrow(terminalInputIdentitySchema, identity))
        const decodedIntent =
          intent === undefined
            ? undefined
            : yield* Effect.try(() => decodeUnknownOrThrow(terminalInputIntentSchema, intent))
        if (decodedIntent !== undefined && decodedIdentity === undefined) {
          return yield* Effect.fail(
            new Error('Semantic terminal input requires an idempotency identity.'),
          )
        }
        const parsed = safeDecodeUnknown(terminalWriteSchema, data)
        const byteLimit =
          decodedIntent?.kind === 'project-action'
            ? TERMINAL.MAX_PROJECT_ACTION_INPUT_BYTES
            : TERMINAL.MAX_INPUT_BYTES
        if (
          !parsed.success ||
          (typeof data === 'string' && Buffer.byteLength(data, 'utf8') > byteLimit)
        ) {
          return {
            status: 'rejected',
            acceptedBytes: 0,
            reason: typeof data === 'string' && data.length === 0 ? 'empty' : 'input-too-large',
            ...(decodedIdentity === undefined ? {} : { identity: decodedIdentity }),
          } as const
        }
        if (parsed.data.length === 0) {
          return {
            status: 'rejected',
            acceptedBytes: 0,
            reason: 'empty',
            ...(decodedIdentity === undefined ? {} : { identity: decodedIdentity }),
          } as const
        }
        const service = yield* TerminalService
        return yield* service.write(
          owner.ownerKey,
          owner.terminalId,
          parsed.data,
          decodedIdentity,
          decodedIntent,
        )
      }),
  )

  typedHandle(
    'terminal:send-input-now',
    (_event, ownerKey: string, terminalId: string, incarnation?: string) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.try(() =>
          decodeUnknownOrThrow(terminalInputReleaseSchema, {
            ownerKey,
            terminalId,
            ...(incarnation === undefined ? {} : { incarnation }),
          }),
        )
        const service = yield* TerminalService
        return yield* service.sendInputNow(
          decoded.ownerKey,
          decoded.terminalId,
          decoded.incarnation,
        )
      }),
  )

  typedHandle('terminal:migrate-owner', (_event, fromOwnerKey: string, toOwnerKey: string) =>
    Effect.gen(function* () {
      const decoded = yield* Effect.try(() =>
        decodeUnknownOrThrow(terminalOwnerMigrationSchema, { fromOwnerKey, toOwnerKey }),
      )
      const service = yield* TerminalService
      return yield* service.migrateOwner(decoded.fromOwnerKey, decoded.toOwnerKey)
    }),
  )

  typedOn(
    'terminal:ack-output',
    (_event, ownerKey: string, terminalId: string, outputGeneration: number, endOffset: number) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.try(() =>
          decodeUnknownOrThrow(terminalOutputAckSchema, {
            ownerKey,
            terminalId,
            outputGeneration,
            endOffset,
          }),
        )
        const service = yield* TerminalService
        yield* service.acknowledgeOutput(
          decoded.ownerKey,
          decoded.terminalId,
          decoded.outputGeneration,
          decoded.endOffset,
        )
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
    throw error
  })
}
