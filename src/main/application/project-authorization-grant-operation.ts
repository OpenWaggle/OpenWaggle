import { safeDecodeUnknown } from '@shared/schema'
import { authorizationScopeKeySchema } from '@shared/schemas/validation'
import * as Effect from 'effect/Effect'
import { validateRequiredProjectPath } from '../utils/project-path-validation'
import { grantForProject, revokeForProject } from './agent-authorization-grants'

function validateAuthorizationScopeKey(key: unknown) {
  const result = safeDecodeUnknown(authorizationScopeKeySchema, key)
  if (!result.success) {
    return Effect.fail(new Error(`Invalid authorization scope key: ${result.issues.join('; ')}`))
  }

  const requester = result.data.requester.trim()
  if (!requester) {
    return Effect.fail(new Error('Authorization scope key requires a requester.'))
  }

  // Identity, so an empty one would make every grant for that capability look alike.
  const requesterId = result.data.requesterId.trim()
  if (!requesterId) {
    return Effect.fail(new Error('Authorization scope key requires a requester id.'))
  }

  const resource = result.data.resource?.trim()
  return Effect.succeed({
    requester,
    requesterId,
    capability: result.data.capability,
    ...(resource ? { resource } : {}),
  })
}

function editProjectAuthorizationOperation(
  rawProjectPath: unknown,
  rawKey: unknown,
  edit: typeof grantForProject,
) {
  return Effect.gen(function* () {
    const projectPath = yield* validateRequiredProjectPath(
      typeof rawProjectPath === 'string' ? rawProjectPath : null,
    )
    const key = yield* validateAuthorizationScopeKey(rawKey)
    yield* Effect.promise(() => edit(projectPath, key))
  })
}

export function grantProjectAuthorizationOperation(rawProjectPath: unknown, rawKey: unknown) {
  return editProjectAuthorizationOperation(rawProjectPath, rawKey, grantForProject)
}

export function revokeProjectAuthorizationOperation(rawProjectPath: unknown, rawKey: unknown) {
  return editProjectAuthorizationOperation(rawProjectPath, rawKey, revokeForProject)
}
