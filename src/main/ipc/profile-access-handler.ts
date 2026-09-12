import { randomUUID } from 'node:crypto'
import {
  decodeLocalSessionProfileManagementResponse,
  decodeLocalSessionProfileUiCommand,
} from '@shared/schemas/local-session-profile-management'
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
  ProfileCredentialCommitError,
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

class UnknownProfileCredentialOutcomeError extends Error {
  readonly code = 'profile_credential_outcome_unknown'

  constructor(
    readonly operation: LocalSessionProfileUiCommand['operation'],
    readonly profileName: string,
    readonly idempotencyKey: string,
    readonly recoveryLocation: string,
  ) {
    super(
      `The ${operation} outcome for profile "${profileName}" is unknown. ` +
        `Operation reference: ${idempotencyKey}. ` +
        `Its credential remains protected at ${recoveryLocation}. ` +
        'Confirm the Host outcome and recover the credential before removing it. ' +
        'A new GUI or CLI request is not a replay of this operation.',
    )
    this.name = 'UnknownProfileCredentialOutcomeError'
  }
}

class RetainedProfileCredentialRecoveryError extends Error {
  readonly code = 'profile_credential_recovery_required'
  readonly outcome = 'rejected'

  constructor(
    readonly operation: LocalSessionProfileUiCommand['operation'],
    readonly idempotencyKey: string,
    readonly recoveryLocation: string,
  ) {
    super(
      `The ${operation} request was rejected (operation reference: ${idempotencyKey}). ` +
        `A credential from an earlier request remains protected at ${recoveryLocation}. ` +
        'The earlier outcome is unknown; confirm it and recover the credential before removing it. ' +
        'This reference belongs to the rejected request, not the earlier operation.',
    )
    this.name = 'RetainedProfileCredentialRecoveryError'
  }
}

export class AcceptedProfileCredentialRecoveryError extends Error {
  readonly code = 'profile_credential_recovery_required'

  constructor(
    readonly profileId: string,
    readonly profileName: string,
    readonly idempotencyKey: string,
    readonly recoveryLocation: string,
    options: ErrorOptions,
  ) {
    super(
      `Profile "${profileName}" was created, but its credential installation did not finish. ` +
        `The protected secret remains recoverable at ${recoveryLocation}. ` +
        `Operation reference: ${idempotencyKey}. ` +
        'Recover the credential before removing it; a new GUI or CLI request is not a replay.',
      options,
    )
    this.name = 'AcceptedProfileCredentialRecoveryError'
  }
}

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
  const outcome = input.response.outcome
  const disconnectInvalidatedProfile = Effect.sync(() => {
    if (outcome.effect === 'profile-revoked' || outcome.effect === 'profile-rotated') {
      disconnectLocalSessionProfile(outcome.profile.id)
    }
  })
  return Effect.gen(function* () {
    const staged = input.staged
    if (outcome.effect === 'rejected') {
      if (staged?.recoveredPending) {
        return yield* Effect.fail(
          new RetainedProfileCredentialRecoveryError(
            outcome.operation,
            input.response.idempotencyKey,
            staged.recoveryLocation,
          ),
        )
      }
      if (staged) yield* Effect.promise(() => staged.discard())
      return
    }
    if (staged) {
      yield* Effect.tryPromise({
        try: () => staged.commit(),
        catch: (cause) => {
          if (
            outcome.effect !== 'profile-created' ||
            !(cause instanceof ProfileCredentialCommitError)
          ) {
            return cause instanceof Error ? cause : new Error(String(cause))
          }
          return new AcceptedProfileCredentialRecoveryError(
            outcome.profile.id,
            outcome.profile.name,
            input.response.idempotencyKey,
            cause.recoveryLocation,
            { cause },
          )
        },
      })
    }
    if (outcome.effect === 'profile-updated') {
      yield* Effect.promise(() => refreshLocalSessionProfileAdmissions(outcome.profile.id))
    }
    if (outcome.effect === 'profile-revoked') {
      yield* Effect.tryPromise({
        try: () =>
          removeStoredProfileCredential({
            stateRoot: input.stateRoot,
            profileName: outcome.profile.name,
          }),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    }
  }).pipe(Effect.ensuring(disconnectInvalidatedProfile))
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
        const result = yield* dispatchLocalSessionCommand({
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
        return yield* Effect.try({
          try: () => {
            if (result.contract !== 'local-access-v1') {
              throw new Error('Session Host returned an invalid profile response.')
            }
            const response = decodeLocalSessionProfileManagementResponse(result.response)
            if (response.outcome.operation !== command.operation) {
              throw new Error('Session Host returned an invalid profile response.')
            }
            return response
          },
          catch: () => new Error('Session Host returned an invalid profile response.'),
        })
      })
      const response = yield* dispatch.pipe(
        Effect.catchAllCause((cause) =>
          staged && profileName
            ? Effect.fail(
                new UnknownProfileCredentialOutcomeError(
                  command.operation,
                  profileName,
                  idempotencyKey,
                  staged.recoveryLocation,
                ),
              )
            : Effect.failCause(cause),
        ),
      )
      yield* settleProfileCredential({ response, staged, stateRoot: paths.stateRoot })
      return response
    }),
  )
}
