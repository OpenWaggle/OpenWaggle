import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { dispatchHostBackedSessionGuiOperation } from '../application/host-ui-session-operation-dispatcher'
import { createLogger } from '../logger'
import { InlineVisualizationService } from '../ports/inline-visualization-service'
import { hostHandle as typedHandle } from './typed-ipc'

const logger = createLogger('session-details-handler')

function deleteSession(id: SessionId) {
  return Effect.gen(function* () {
    const visualizations = yield* InlineVisualizationService
    const stagedDeletion = yield* visualizations.stageSessionDeletion(id)
    yield* dispatchHostBackedSessionGuiOperation('sessions:delete', [id]).pipe(
      Effect.tapError(() => stagedDeletion.rollback),
    )
    yield* stagedDeletion.commit.pipe(
      Effect.catchAll((error) => {
        logger.warn('Deferred visualization tombstone cleanup after session deletion', {
          sessionId: String(id),
          error: String(error),
        })
        return Effect.void
      }),
    )
  })
}

export function registerSessionDetailsHandlers(): void {
  typedHandle('sessions:get-detail', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:get-detail', args),
  )
  typedHandle('sessions:turn-checkpoints:list', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:turn-checkpoints:list', args),
  )
  typedHandle('sessions:turn-diff:get', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:turn-diff:get', args),
  )
  typedHandle('sessions:pins:list', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:pins:list', args),
  )
  typedHandle('sessions:pins:pin', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:pins:pin', args),
  )
  typedHandle('sessions:pins:unpin', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:pins:unpin', args),
  )
  typedHandle('sessions:pins:move', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:pins:move', args),
  )
  typedHandle('sessions:create', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:create', args),
  )
  typedHandle('sessions:fork-to-new', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:fork-to-new', args),
  )
  typedHandle('sessions:clone-to-new', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:clone-to-new', args),
  )
  typedHandle('sessions:dismiss-interrupted-run', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:dismiss-interrupted-run', args),
  )
  typedHandle('sessions:delete', (_event, id) => deleteSession(id))
  typedHandle('sessions:archive', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:archive', args),
  )
  typedHandle('sessions:unarchive', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:unarchive', args),
  )
  typedHandle('sessions:update-title', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:update-title', args),
  )
  typedHandle('sessions:set-authorization-mode', (_event, ...args) =>
    dispatchHostBackedSessionGuiOperation('sessions:set-authorization-mode', args),
  )
}
