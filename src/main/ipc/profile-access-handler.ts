import { randomUUID } from 'node:crypto'
import { decodeLocalSessionProfileUiCommand } from '@shared/schemas/local-session-profile-management'
import {
  LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
  type LocalSessionProfileManagementCommand,
  type LocalSessionProfileManagementResponse,
  type LocalSessionProfileUiCommand,
} from '@shared/types/local-session-profile-management'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import { dispatchLocalSessionCommand } from '../application/local-session-command-dispatcher'
import { resolveLocalSessionHostPaths } from '../session-host/local-session-paths'
import {
  disconnectLocalSessionProfile,
  refreshLocalSessionProfileAdmissions,
} from '../session-host/local-session-profile-invalidation'
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

type StagedProfileCredential = Awaited<ReturnType<typeof stageProfileCredential>>

function generateCommandCredential(command: LocalSessionProfileUiCommand) {
  return command.operation === 'create' || command.operation === 'rotate'
    ? generateProfileCredential()
    : undefined
}

function commandProfileName(command: LocalSessionProfileUiCommand) {
  if (command.operation === 'create') return command.name
  return 'profileName' in command ? command.profileName : undefined
}

function stageCommandCredential(input: {
  readonly command: LocalSessionProfileUiCommand
  readonly credential: string | undefined
  readonly profileName: string | undefined
  readonly stateRoot: string
  readonly idempotencyKey: string
}) {
  if (!input.credential || !input.profileName) {
    return Effect.succeed<StagedProfileCredential | undefined>(undefined)
  }
  const { credential, profileName } = input
  return Effect.tryPromise({
    try: () =>
      stageProfileCredential({
        destination: { kind: 'credential-store', stateRoot: input.stateRoot },
        profileName,
        credential,
        replace: input.command.operation === 'rotate',
        stagingKey: input.idempotencyKey,
        recoverAnyPending: true,
      }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function settleProfileCredential(input: {
  readonly response: LocalSessionProfileManagementResponse
  readonly staged: StagedProfileCredential | undefined
  readonly stateRoot: string
}) {
  return Effect.gen(function* () {
    const staged = input.staged
    if (input.response.outcome.effect === 'rejected') {
      if (staged) yield* Effect.promise(() => staged.discard())
      return
    }
    if (staged) yield* Effect.promise(() => staged.commit())
    if (input.response.outcome.effect === 'profile-updated') {
      const profileId = input.response.outcome.profile.id
      yield* Effect.promise(() => refreshLocalSessionProfileAdmissions(profileId))
    }
    if (input.response.outcome.effect === 'profile-revoked') {
      const revokedProfileName = input.response.outcome.profile.name
      yield* Effect.promise(() =>
        removeStoredProfileCredential({
          stateRoot: input.stateRoot,
          profileName: revokedProfileName,
        }),
      )
    }
    if (
      input.response.outcome.effect === 'profile-revoked' ||
      input.response.outcome.effect === 'profile-rotated'
    ) {
      disconnectLocalSessionProfile(input.response.outcome.profile.id)
    }
  })
}

export function registerProfileAccessHandlers() {
  typedHandle('access-profiles:manage', (_event, rawCommand) =>
    Effect.gen(function* () {
      const command = decodeLocalSessionProfileUiCommand(rawCommand)
      const credential = generateCommandCredential(command)
      const idempotencyKey = randomUUID()
      const profileName = commandProfileName(command)
      const paths = resolveLocalSessionHostPaths({ userDataRoot: app.getPath('userData') })
      const staged = yield* stageCommandCredential({
        command,
        credential,
        profileName,
        stateRoot: paths.stateRoot,
        idempotencyKey,
      })
      const dispatch = Effect.gen(function* () {
        return yield* dispatchLocalSessionCommand({
          caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
          payload: {
            contract: 'local-access-v1',
            request: {
              contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
              requestId: randomUUID(),
              idempotencyKey,
              command: managementCommand(command, staged?.credential ?? credential),
            },
          },
        })
      })
      const result = yield* dispatch.pipe(
        Effect.tapError(() =>
          staged
            ? Effect.promise(() => staged.discard()).pipe(Effect.orDie, Effect.asVoid)
            : Effect.void,
        ),
      )
      if (result.contract !== 'local-access-v1') {
        return yield* Effect.fail(new Error('Session Host returned an invalid profile response.'))
      }
      const response = result.response
      yield* settleProfileCredential({ response, staged, stateRoot: paths.stateRoot })
      return response
    }),
  )
}
