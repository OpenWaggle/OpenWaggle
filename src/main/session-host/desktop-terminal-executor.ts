import { matchBy } from '@diegogbrisa/ts-match'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { desktopTerminalResultSchema } from '@shared/schemas/desktop-terminal-service'
import type {
  DesktopTerminalCommand,
  DesktopTerminalResult,
} from '@shared/types/desktop-terminal-service'
import * as Effect from 'effect/Effect'
import type { TerminalServiceShape } from '../ports/terminal-service'

function response<K extends DesktopTerminalResult['operation'], A>(
  operation: K,
  effect: Effect.Effect<A, Error>,
) {
  return effect.pipe(Effect.map((value) => ({ service: 'terminal' as const, operation, value })))
}

function voidResponse<K extends DesktopTerminalResult['operation']>(
  operation: K,
  effect: Effect.Effect<void, Error>,
) {
  return response(operation, effect.pipe(Effect.as(null)))
}

export function executeDesktopTerminalCommand(
  service: TerminalServiceShape,
  input: DesktopTerminalCommand,
): Effect.Effect<DesktopTerminalResult, Error> {
  const result: Effect.Effect<DesktopTerminalResult, Error> = matchBy(input, 'operation')
    .with('getActivitySnapshot', () =>
      response('getActivitySnapshot', service.getActivitySnapshot()),
    )
    .with('open', (command) => response('open', service.open(command.input)))
    .with('restart', (command) => response('restart', service.restart(command.input)))
    .with('write', ({ input }) =>
      response(
        'write',
        service.write(input.ownerKey, input.terminalId, input.data, input.identity, input.intent),
      ),
    )
    .with('sendInputNow', ({ input }) =>
      response('sendInputNow', service.sendInputNow(input.ownerKey, input.terminalId)),
    )
    .with('acknowledgeOutput', ({ input }) =>
      voidResponse(
        'acknowledgeOutput',
        service.acknowledgeOutput(
          input.ownerKey,
          input.terminalId,
          input.outputGeneration,
          input.endOffset,
        ),
      ),
    )
    .with('migrateOwner', ({ input }) =>
      response('migrateOwner', service.migrateOwner(input.fromOwnerKey, input.toOwnerKey)),
    )
    .with('resize', ({ input }) =>
      voidResponse(
        'resize',
        service.resize(input.ownerKey, input.terminalId, input.cols, input.rows),
      ),
    )
    .with('clear', ({ input }) =>
      voidResponse('clear', service.clear(input.ownerKey, input.terminalId)),
    )
    .with('assessClose', ({ input }) =>
      response('assessClose', service.assessClose(input.ownerKey, input.terminalId)),
    )
    .with('close', ({ input }) =>
      voidResponse('close', service.close(input.ownerKey, input.terminalId, input.deleteHistory)),
    )
    .with('closeAllForOwner', ({ input }) =>
      voidResponse(
        'closeAllForOwner',
        service.closeAllForOwner(input.ownerKey, input.deleteHistory),
      ),
    )
    .with('closeAllUnderPath', ({ input }) =>
      voidResponse(
        'closeAllUnderPath',
        service.closeAllUnderPath(input.directoryPath, input.deleteHistory),
      ),
    )
    .with('attachSurface', ({ input }) =>
      voidResponse('attachSurface', service.attachSurface(input.terminalKey, input.surfaceId)),
    )
    .with('detachTerminal', ({ input }) =>
      voidResponse(
        'detachTerminal',
        service.detachTerminal(input.ownerKey, input.terminalId, input.surfaceId),
      ),
    )
    .with('detachSurface', ({ input }) =>
      voidResponse('detachSurface', service.detachSurface(input.surfaceId)),
    )
    .with('closeAll', () => voidResponse('closeAll', service.closeAll()))
    .exhaustive()
  return result.pipe(
    Effect.flatMap((value) =>
      Effect.try({
        try: () => decodeUnknownExactOrThrow(desktopTerminalResultSchema, value),
        catch: () => new Error('The desktop returned a malformed terminal result.'),
      }),
    ),
  )
}
