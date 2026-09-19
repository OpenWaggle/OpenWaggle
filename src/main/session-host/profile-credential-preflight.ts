import path from 'node:path'
import type { ProfileCredentialDestination } from './profile-credential-destination'
import {
  assertReplaceable,
  credentialFingerprint,
  decodeCredentialContent,
} from './profile-credential-destination-support'
import { readOwnedFile } from './profile-credential-owned-files'

interface CredentialPreflightInput {
  readonly destination: ProfileCredentialDestination
  readonly targetPath: string
  readonly selectedCredential: string
  readonly replace: boolean
}

class ProfileCredentialPreparationError extends Error {
  constructor(
    readonly recoveryLocation: string,
    cause: unknown,
  ) {
    super(
      `Credential destination validation failed. Protected credential data remains recoverable at ${recoveryLocation}. Confirm any prior operation before removing it.`,
      { cause },
    )
    this.name = 'ProfileCredentialPreparationError'
  }
}

async function matchesInstalledCredential(
  input: CredentialPreflightInput,
  stagedDestinationIdentity: Awaited<ReturnType<typeof assertReplaceable>>,
) {
  if (!stagedDestinationIdentity || input.replace) return false
  const target = await readOwnedFile(
    path.dirname(input.targetPath),
    path.basename(input.targetPath),
  )
  if (!target.content) throw new Error('Credential destination changed during preparation.')
  const targetCredential = decodeCredentialContent(input.destination, target.content)
  if (credentialFingerprint(targetCredential) === credentialFingerprint(input.selectedCredential)) {
    return true
  }
  throw new Error('Credential destination already exists. Use --replace to update it.')
}

export async function validateCredentialDestination(input: CredentialPreflightInput) {
  const stagedDestinationIdentity = await assertReplaceable(input.targetPath, true)
  const alreadyInstalled = await matchesInstalledCredential(input, stagedDestinationIdentity)
  return { stagedDestinationIdentity, alreadyInstalled }
}

/** Creation does not confer exclusive ownership: another caller may already have adopted it. */
export async function validateStagedCredentialDestination(
  input: CredentialPreflightInput & {
    readonly stagingDirectory: string
    readonly temporaryName: string
  },
) {
  try {
    return await validateCredentialDestination(input)
  } catch (cause) {
    const recoveryLocation = path.join(input.stagingDirectory, input.temporaryName)
    throw new ProfileCredentialPreparationError(recoveryLocation, cause)
  }
}
