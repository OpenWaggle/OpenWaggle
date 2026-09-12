import type { LocalSessionProfileManagementResponse } from '@shared/types/local-session-profile-management'
import { ProfileCredentialCommitError } from './session-host/profile-credential-destination'

export class AcceptedProfileCredentialRecoveryError extends Error {
  readonly preserveStagedCredential = true

  constructor(input: {
    readonly operation: 'create' | 'rotate'
    readonly profileId: string
    readonly profileName: string
    readonly idempotencyKey: string
    readonly recoveryLocation: string
    readonly cause: ProfileCredentialCommitError
  }) {
    const effect = input.operation === 'create' ? 'created' : 'rotated'
    super(
      `Profile "${input.profileName}" (${input.profileId}) was ${effect}, but its credential ` +
        `installation did not finish. The protected secret remains recoverable at ` +
        `${input.recoveryLocation}. Retry the accepted operation with ` +
        `--idempotency-key ${input.idempotencyKey}.`,
      { cause: input.cause },
    )
    this.name = 'AcceptedProfileCredentialRecoveryError'
  }
}

export async function commitAcceptedProfileCredential(input: {
  readonly response: LocalSessionProfileManagementResponse
  readonly commit: (() => Promise<void>) | undefined
  readonly idempotencyKey: string
}) {
  try {
    await input.commit?.()
  } catch (cause) {
    const outcome = input.response.outcome
    if (
      cause instanceof ProfileCredentialCommitError &&
      (outcome.effect === 'profile-created' || outcome.effect === 'profile-rotated')
    ) {
      throw new AcceptedProfileCredentialRecoveryError({
        operation: outcome.operation,
        profileId: outcome.profile.id,
        profileName: outcome.profile.name,
        idempotencyKey: input.idempotencyKey,
        recoveryLocation: cause.recoveryLocation,
        cause,
      })
    }
    throw cause
  }
}
