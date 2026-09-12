import type {
  TerminalActivitySnapshot,
  TerminalId,
  TerminalInputIdentity,
  TerminalInputIntent,
  TerminalKey,
  TerminalOpenInput,
  TerminalOwnerKey,
} from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import type { TerminalEventSinkShape } from '../../ports/terminal-event-sink'
import type { TerminalServiceShape } from '../../ports/terminal-service'
import type { TerminalAttachmentTracker } from './terminal-attachment-tracker'
import {
  assessTerminalCloseAction,
  closeAllTerminalsAction,
  closeOwnerTerminalsAction,
  closeTerminalAction,
  closeTerminalsUnderPathAction,
} from './terminal-close-actions'
import { forceReleaseTerminalInputAction, writeTerminalAction } from './terminal-input-actions'
import { acknowledgeTerminalOutputAction, resizeTerminalAction } from './terminal-io-actions'
import { clearTerminalAction, restartTerminalAction } from './terminal-lifecycle-actions'
import { blockTerminalOwner, blockTerminalPath } from './terminal-operation-queue'
import { migrateTerminalOwnerAction } from './terminal-owner-migration'
import { openTerminalAction, type TerminalActionContext } from './terminal-service-actions'

interface TerminalServiceFacadeOptions {
  readonly sink: TerminalEventSinkShape
  readonly context: TerminalActionContext
  readonly attachments: TerminalAttachmentTracker
  readonly resolveAlias: (key: TerminalKey) => TerminalKey
  readonly acknowledgeCurrentOutput: (key: TerminalKey) => void
  readonly pruneInactive: () => void
  readonly getActivitySnapshot: () => TerminalActivitySnapshot
  readonly notifyRecordChanged: () => void
}

export function makeTerminalServiceFacade(
  options: TerminalServiceFacadeOptions,
): TerminalServiceShape {
  const { context } = options
  return {
    getActivitySnapshot: () => Effect.sync(options.getActivitySnapshot),
    attachSurface: (terminalKey, surfaceId) =>
      Effect.gen(function* () {
        const key = options.resolveAlias(terminalKey)
        yield* options.sink.attach(key, surfaceId)
        options.attachments.attach(key, surfaceId)
      }),
    detachTerminal: (ownerKey: TerminalOwnerKey, terminalId: TerminalId, surfaceId: number) =>
      Effect.gen(function* () {
        const key = options.resolveAlias(terminalKeyOf(ownerKey, terminalId))
        const orphaned = yield* options.sink.detach(key, surfaceId)
        options.attachments.detach(key, surfaceId, orphaned)
        if (orphaned) options.acknowledgeCurrentOutput(key)
        if (orphaned) options.pruneInactive()
      }),
    detachSurface: (surfaceId) =>
      Effect.gen(function* () {
        const orphanedKeys = yield* options.sink.detachSurface(surfaceId)
        options.attachments.detachSurface(surfaceId, orphanedKeys)
        for (const key of orphanedKeys) options.acknowledgeCurrentOutput(key)
        if (orphanedKeys.length > 0) options.pruneInactive()
      }),
    open: (input: TerminalOpenInput) => openTerminalAction(context, input),
    write: (
      ownerKey: TerminalOwnerKey,
      terminalId: TerminalId,
      data: string,
      identity?: TerminalInputIdentity,
      intent?: TerminalInputIntent,
    ) => writeTerminalAction(context, ownerKey, terminalId, data, identity, intent),
    sendInputNow: (ownerKey: TerminalOwnerKey, terminalId: TerminalId, incarnation?: string) =>
      forceReleaseTerminalInputAction(context, ownerKey, terminalId, incarnation),
    acknowledgeOutput: (ownerKey, terminalId, outputGeneration, endOffset) =>
      acknowledgeTerminalOutputAction(context, ownerKey, terminalId, outputGeneration, endOffset),
    migrateOwner: (fromOwnerKey, toOwnerKey) =>
      migrateTerminalOwnerAction(context, fromOwnerKey, toOwnerKey),
    resize: (ownerKey, terminalId, cols, rows) =>
      resizeTerminalAction(context, ownerKey, terminalId, cols, rows),
    clear: (ownerKey, terminalId) => clearTerminalAction(context, ownerKey, terminalId),
    restart: (input) => restartTerminalAction(context, input),
    assessClose: (ownerKey, terminalId) => assessTerminalCloseAction(context, ownerKey, terminalId),
    close: (ownerKey, terminalId, deleteHistory) =>
      closeTerminalAction(context, ownerKey, terminalId, deleteHistory),
    closeAllForOwner: (ownerKey, deleteHistory) =>
      closeOwnerTerminalsAction(context, ownerKey, deleteHistory),
    closeAllUnderPath: (directoryPath, deleteHistory) =>
      closeTerminalsUnderPathAction(context, directoryPath, deleteHistory),
    runWithMutationFence: (scope, operation) =>
      Effect.acquireUseRelease(
        Effect.sync(() =>
          scope.kind === 'owner'
            ? blockTerminalOwner(context.operationQueue, scope.ownerKey)
            : blockTerminalPath(context.operationQueue, scope.directoryPath),
        ),
        () => operation,
        (release) => Effect.sync(release),
      ),
    closeAll: () =>
      Effect.gen(function* () {
        yield* closeAllTerminalsAction(context)
        options.notifyRecordChanged()
      }),
  }
}
