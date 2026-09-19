export class ProfileCredentialCommitError extends Error {
  constructor(
    message: string,
    readonly recoveryLocation: string,
    options?: ErrorOptions,
    readonly additionalRecoveryLocations: readonly string[] = [],
  ) {
    super(message, options)
    this.name = 'ProfileCredentialCommitError'
  }
}

export class ProfileCredentialCleanupError extends Error {
  constructor(
    readonly recoveryLocation: string,
    options?: ErrorOptions,
  ) {
    super(
      `Protected credential cleanup failed for ${recoveryLocation}. Recovery data may remain in its staging directory.`,
      options,
    )
    this.name = 'ProfileCredentialCleanupError'
  }
}

export class ProfileCredentialPendingRecoveryError extends Error {
  constructor(
    readonly recoveryLocation: string,
    options?: ErrorOptions,
  ) {
    super(
      `Protected credential recovery cannot be completed for ${recoveryLocation}. Verify the credential destination before retrying.`,
      options,
    )
    this.name = 'ProfileCredentialPendingRecoveryError'
  }
}
