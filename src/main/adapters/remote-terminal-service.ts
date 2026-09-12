import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  DesktopServiceBroker,
  type DesktopServiceBrokerShape,
} from '../ports/desktop-service-broker'
import { TerminalService, type TerminalServiceShape } from '../ports/terminal-service'

function invalidResult() {
  return Effect.fail(new Error('The desktop returned an invalid terminal result.'))
}

export function makeRemoteTerminalService(broker: DesktopServiceBrokerShape): TerminalServiceShape {
  return new RemoteTerminalService(broker)
}

class RemoteTerminalService implements TerminalServiceShape {
  constructor(private readonly broker: DesktopServiceBrokerShape) {}

  getActivitySnapshot: TerminalServiceShape['getActivitySnapshot'] = () =>
    this.broker
      .execute({ service: 'terminal', operation: 'getActivitySnapshot', input: {} })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'getActivitySnapshot'
            ? Effect.succeed(result.value)
            : invalidResult(),
        ),
      )

  open: TerminalServiceShape['open'] = (input) =>
    this.broker
      .execute({ service: 'terminal', operation: 'open', input: input })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'open'
            ? Effect.succeed(result.value)
            : invalidResult(),
        ),
      )

  restart: TerminalServiceShape['restart'] = (input) =>
    this.broker
      .execute({ service: 'terminal', operation: 'restart', input: input })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'restart'
            ? Effect.succeed(result.value)
            : invalidResult(),
        ),
      )

  write: TerminalServiceShape['write'] = (ownerKey, terminalId, data, identity, intent) =>
    this.broker
      .execute({
        service: 'terminal',
        operation: 'write',
        input: {
          ownerKey,
          terminalId,
          data,
          ...(identity ? { identity } : {}),
          ...(intent ? { intent } : {}),
        },
      })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'write'
            ? Effect.succeed(result.value)
            : invalidResult(),
        ),
      )

  sendInputNow: TerminalServiceShape['sendInputNow'] = (ownerKey, terminalId, incarnation) =>
    this.broker
      .execute({
        service: 'terminal',
        operation: 'sendInputNow',
        input: { ownerKey, terminalId, ...(incarnation === undefined ? {} : { incarnation }) },
      })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'sendInputNow'
            ? Effect.succeed(result.value)
            : invalidResult(),
        ),
      )

  acknowledgeOutput: TerminalServiceShape['acknowledgeOutput'] = (
    ownerKey,
    terminalId,
    outputGeneration,
    endOffset,
  ) =>
    this.broker
      .execute({
        service: 'terminal',
        operation: 'acknowledgeOutput',
        input: { ownerKey, terminalId, outputGeneration, endOffset },
      })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'acknowledgeOutput'
            ? Effect.void
            : invalidResult(),
        ),
      )

  migrateOwner: TerminalServiceShape['migrateOwner'] = (fromOwnerKey, toOwnerKey) =>
    this.broker
      .execute({
        service: 'terminal',
        operation: 'migrateOwner',
        input: { fromOwnerKey, toOwnerKey },
      })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'migrateOwner'
            ? Effect.succeed(result.value)
            : invalidResult(),
        ),
      )

  resize: TerminalServiceShape['resize'] = (ownerKey, terminalId, cols, rows) =>
    this.broker
      .execute({
        service: 'terminal',
        operation: 'resize',
        input: { ownerKey, terminalId, cols, rows },
      })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'resize'
            ? Effect.void
            : invalidResult(),
        ),
      )

  clear: TerminalServiceShape['clear'] = (ownerKey, terminalId) =>
    this.broker
      .execute({ service: 'terminal', operation: 'clear', input: { ownerKey, terminalId } })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'clear'
            ? Effect.void
            : invalidResult(),
        ),
      )

  assessClose: TerminalServiceShape['assessClose'] = (ownerKey, terminalId) =>
    this.broker
      .execute({ service: 'terminal', operation: 'assessClose', input: { ownerKey, terminalId } })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'assessClose'
            ? Effect.succeed(result.value)
            : invalidResult(),
        ),
      )

  close: TerminalServiceShape['close'] = (ownerKey, terminalId, deleteHistory) =>
    this.broker
      .execute({
        service: 'terminal',
        operation: 'close',
        input: { ownerKey, terminalId, deleteHistory },
      })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'close'
            ? Effect.void
            : invalidResult(),
        ),
      )

  closeAllForOwner: TerminalServiceShape['closeAllForOwner'] = (ownerKey, deleteHistory) =>
    this.broker
      .execute({
        service: 'terminal',
        operation: 'closeAllForOwner',
        input: { ownerKey, deleteHistory },
      })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'closeAllForOwner'
            ? Effect.void
            : invalidResult(),
        ),
      )

  closeAllUnderPath: TerminalServiceShape['closeAllUnderPath'] = (directoryPath, deleteHistory) =>
    this.broker
      .execute({
        service: 'terminal',
        operation: 'closeAllUnderPath',
        input: { directoryPath, deleteHistory },
      })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'closeAllUnderPath'
            ? Effect.void
            : invalidResult(),
        ),
      )

  attachSurface: TerminalServiceShape['attachSurface'] = (terminalKey, surfaceId) =>
    this.broker
      .execute({
        service: 'terminal',
        operation: 'attachSurface',
        input: { terminalKey, surfaceId },
      })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'attachSurface'
            ? Effect.void
            : invalidResult(),
        ),
      )

  detachTerminal: TerminalServiceShape['detachTerminal'] = (ownerKey, terminalId, surfaceId) =>
    this.broker
      .execute({
        service: 'terminal',
        operation: 'detachTerminal',
        input: { ownerKey, terminalId, surfaceId },
      })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'detachTerminal'
            ? Effect.void
            : invalidResult(),
        ),
      )

  detachSurface: TerminalServiceShape['detachSurface'] = (surfaceId) =>
    this.broker
      .execute({ service: 'terminal', operation: 'detachSurface', input: { surfaceId } })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'detachSurface'
            ? Effect.void
            : invalidResult(),
        ),
      )

  closeAll: TerminalServiceShape['closeAll'] = () =>
    this.broker
      .execute({ service: 'terminal', operation: 'closeAll', input: {} })
      .pipe(
        Effect.flatMap((result) =>
          result.service === 'terminal' && result.operation === 'closeAll'
            ? Effect.void
            : invalidResult(),
        ),
      )

  runWithMutationFence: TerminalServiceShape['runWithMutationFence'] = (scope, operation) =>
    this.broker.runWithMutationFence(scope, operation)
}

export const RemoteTerminalServiceLive = Layer.effect(
  TerminalService,
  Effect.map(DesktopServiceBroker, makeRemoteTerminalService),
)
