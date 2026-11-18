import { createHash } from 'node:crypto'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import type { LocalSessionProfileManagementCommand } from '@shared/types/local-session-profile-management'
import * as Effect from 'effect/Effect'
import { createProfileCredentialVerifier } from '../session-host/profile-credential'
import { profileCredentialGenerationBudget } from '../session-host/profile-credential-generation-budget'
import { canonicalizeExistingDirectoryRoots } from '../utils/canonical-directory-roots'

export function prepareLocalSessionProfileCredential(input: {
  readonly callerId: string
  readonly idempotencyKey: string
  readonly command: LocalSessionProfileManagementCommand
}) {
  const command = input.command
  if (command.operation !== 'create' && command.operation !== 'rotate') {
    return Effect.succeed(undefined)
  }
  const fingerprint = createHash('sha256').update(command.credential).digest('base64url')
  const targetName = (command.operation === 'create' ? command.name : command.profileName).trim()
  const operationKey = JSON.stringify([
    command.operation,
    targetName,
    fingerprint,
    input.idempotencyKey,
  ])
  return Effect.tryPromise({
    try: () =>
      profileCredentialGenerationBudget
        .run({
          callerId: input.callerId,
          operationKey,
          task: () => createProfileCredentialVerifier(command.credential),
        })
        .then((verifier) => ({ verifier, fingerprint })),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function canonicalizeProfileScope(scope: LocalSessionProfileScope) {
  return Effect.tryPromise({
    try: async () => ({
      ...scope,
      ...(scope.projectPaths
        ? {
            projectPaths: await canonicalizeExistingDirectoryRoots(
              scope.projectPaths,
              'Profile project root',
            ),
          }
        : {}),
      ...(scope.workspaceRoots
        ? {
            workspaceRoots: await canonicalizeExistingDirectoryRoots(
              scope.workspaceRoots,
              'Profile workspace root',
            ),
          }
        : {}),
      ...(scope.exportRoots
        ? {
            exportRoots: await canonicalizeExistingDirectoryRoots(
              scope.exportRoots,
              'Profile export root',
            ),
          }
        : {}),
      ...(scope.attachmentRoots
        ? {
            attachmentRoots: await canonicalizeExistingDirectoryRoots(
              scope.attachmentRoots,
              'Profile attachment root',
            ),
          }
        : {}),
    }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

export function canonicalizeLocalSessionProfilePolicyCommand(
  command: LocalSessionProfileManagementCommand,
) {
  if (command.operation !== 'create' && command.operation !== 'update') {
    return Effect.succeed(command)
  }
  return Effect.gen(function* () {
    const scope = yield* canonicalizeProfileScope(command.scope)
    const managementEnvelope = command.managementEnvelope
      ? {
          ...command.managementEnvelope,
          scope: yield* canonicalizeProfileScope(command.managementEnvelope.scope),
        }
      : undefined
    return {
      ...command,
      scope,
      ...(managementEnvelope ? { managementEnvelope } : {}),
    } satisfies LocalSessionProfileManagementCommand
  })
}
