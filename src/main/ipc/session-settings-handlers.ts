import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import { SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { resolveEffectiveAuthorizationMode } from '../application/agent-authorization-mode'
import { grantPendingAuthorizationsForSession } from '../application/agent-loop-interaction-broker'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { typedHandle } from './typed-ipc'

/** `null` is valid and means "clear the override so this session inherits again". */
function validateAuthorizationMode(mode: unknown) {
  if (mode === null || isAgentAuthorizationMode(mode)) return Effect.succeed(mode)
  return Effect.fail(new Error('Session authorization mode is invalid.'))
}

function validateSelectedModel(model: unknown) {
  if (typeof model === 'string' && model.trim().length > 0) {
    return Effect.succeed(SupportedModelId(model))
  }
  return Effect.fail(new Error('Session model is invalid.'))
}

/**
 * Per-session settings that must never live in the global settings row: a mode or model picked in
 * one session is stored on that session's row alone, so it cannot leak into other sessions.
 */
export function registerSessionSettingsHandlers(): void {
  typedHandle('sessions:set-authorization-mode', (_event, id: SessionId, mode: unknown) =>
    Effect.gen(function* () {
      const validatedMode = yield* validateAuthorizationMode(mode)
      const repo = yield* SessionProjectionRepository
      yield* repo.setAuthorizationMode(id, validatedMode)

      // Switching to full access must also clear the question already on screen, otherwise the
      // run stays parked on a prompt in a mode that promises never to prompt. Resolved rather
      // than read from the argument, so clearing an override that reveals a YOLO default counts.
      const effective = yield* Effect.promise(() => resolveEffectiveAuthorizationMode(id))
      if (effective === 'yolo') {
        yield* Effect.sync(() => grantPendingAuthorizationsForSession({ sessionId: id }))
      }
    }),
  )

  typedHandle('sessions:set-selected-model', (_event, id: SessionId, model: unknown) =>
    Effect.gen(function* () {
      const validatedModel = yield* validateSelectedModel(model)
      const repo = yield* SessionProjectionRepository
      yield* repo.setSelectedModel(id, validatedModel)
    }),
  )
}
