export class ProfileCredentialCommitError extends Error {
  readonly recoveryLocation: string
  readonly additionalRecoveryLocations: readonly string[]

  constructor(
    message: string,
    recoveryLocation: string,
    options?: ErrorOptions,
    additionalRecoveryLocations: readonly string[] = [],
  ) {
    super(message, options)
    this.recoveryLocation = recoveryLocation
    this.additionalRecoveryLocations = additionalRecoveryLocations
    this.name = 'ProfileCredentialCommitError'
  }
}

export class ProfileCredentialCleanupError extends Error {
  readonly recoveryLocation: string

  constructor(recoveryLocation: string, options?: ErrorOptions) {
    super(
      `Protected credential cleanup failed for ${recoveryLocation}. Recovery data may remain in its staging directory.`,
      options,
    )
    this.recoveryLocation = recoveryLocation
    this.name = 'ProfileCredentialCleanupError'
  }
}

export class ProfileCredentialPendingRecoveryError extends Error {
  readonly recoveryLocation: string

  constructor(recoveryLocation: string, options?: ErrorOptions) {
    super(
      `Protected credential recovery cannot be completed for ${recoveryLocation}. Verify the credential destination before retrying.`,
      options,
    )
    this.recoveryLocation = recoveryLocation
    this.name = 'ProfileCredentialPendingRecoveryError'
  }
}
