export class ProfileCredentialCommitError extends Error {
  constructor(
    message: string,
    readonly recoveryLocation: string,
    options?: ErrorOptions,
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
