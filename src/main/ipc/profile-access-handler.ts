import { randomUUID } from 'node:crypto'
import { decodeLocalSessionProfileUiCommand } from '@shared/schemas/local-session-profile-management'
import {
  LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
  type LocalSessionProfileManagementCommand,
  type LocalSessionProfileUiCommand,
} from '@shared/types/local-session-profile-management'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import { manageLocalSessionProfiles } from '../application/local-session-profile-management'
import { resolveLocalSessionHostPaths } from '../session-host/local-session-paths'
import { disconnectLocalSessionProfile } from '../session-host/local-session-profile-invalidation'
import { generateProfileCredential } from '../session-host/profile-credential'
import {
  removeStoredProfileCredential,
  stageProfileCredential,
} from '../session-host/profile-credential-destination'
import { typedHandle } from './typed-ipc'

function managementCommand(
  command: LocalSessionProfileUiCommand,
  credential: string | undefined,
): LocalSessionProfileManagementCommand {
  if (command.operation === 'create') {
    if (!credential) throw new Error('Profile creation credential was not generated.')
    return { ...command, credential }
  }
  if (command.operation === 'rotate') {
    if (!credential) throw new Error('Profile rotation credential was not generated.')
    return { ...command, credential }
  }
  return command
}

export function registerProfileAccessHandlers() {
  typedHandle('access-profiles:manage', (_event, rawCommand) =>
    Effect.gen(function* () {
      const command = decodeLocalSessionProfileUiCommand(rawCommand)
      const createsCredential = command.operation === 'create' || command.operation === 'rotate'
      const credential = createsCredential ? generateProfileCredential() : undefined
      const idempotencyKey = randomUUID()
      const profileName =
        command.operation === 'create'
          ? command.name
          : 'profileName' in command
            ? command.profileName
            : undefined
      const paths = resolveLocalSessionHostPaths({ userDataRoot: app.getPath('userData') })
      const staged =
        credential && profileName
          ? yield* Effect.tryPromise({
              try: () =>
                stageProfileCredential({
                  destination: { kind: 'credential-store', stateRoot: paths.stateRoot },
                  profileName,
                  credential,
                  replace: command.operation === 'rotate',
                  stagingKey: idempotencyKey,
                  recoverAnyPending: true,
                }),
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            })
          : undefined
      const response = yield* manageLocalSessionProfiles({
        caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
        request: {
          contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey,
          command: managementCommand(command, staged?.credential ?? credential),
        },
        now: Date.now(),
      }).pipe(
        Effect.tapError(() =>
          staged ? Effect.promise(() => staged.discard()).pipe(Effect.asVoid) : Effect.void,
        ),
      )
      if (response.outcome.effect === 'rejected') {
        if (staged) yield* Effect.promise(() => staged.discard())
        return response
      }
      if (staged) yield* Effect.promise(() => staged.commit())
      const revokedProfileName =
        response.outcome.effect === 'profile-revoked' ? response.outcome.profile.name : undefined
      if (revokedProfileName) {
        yield* Effect.promise(() =>
          removeStoredProfileCredential({
            stateRoot: paths.stateRoot,
            profileName: revokedProfileName,
          }),
        )
      }
      if (
        response.outcome.effect === 'profile-revoked' ||
        response.outcome.effect === 'profile-rotated'
      ) {
        disconnectLocalSessionProfile(response.outcome.profile.id)
      }
      return response
    }),
  )
}
