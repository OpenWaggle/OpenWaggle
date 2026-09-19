import { createHash } from 'node:crypto'
import path from 'node:path'
import { isLocalSessionProfileCredential } from '@shared/types/local-session-profile'
import {
  type CredentialScope,
  installedStoreCredential,
  isConsumedPending,
  markConsumedPending,
} from './profile-credential-consumed'
import type { ProfileCredentialDestination } from './profile-credential-destination'
import { ProfileCredentialPendingRecoveryError } from './profile-credential-destination-errors'
import {
  credentialContent,
  decodeCredentialContent,
  destinationPath,
  openUnlinkedCredentialSource,
} from './profile-credential-destination-support'
import { listOwnedFiles, readOwnedFile, writeOwnedFile } from './profile-credential-owned-files'
import { validateProfileCredential } from './profile-credential-storage'

const LEGACY_PENDING_NAME_COMPONENTS = 3

interface CredentialStagingInput {
  readonly destination: ProfileCredentialDestination
  readonly profileName: string
  readonly credential: string
  readonly stagingIdentity: string
  readonly stagingDirectory: string
  readonly recoverAnyPending?: boolean
  readonly beforeCreate?: () => Promise<void>
  readonly beforeStagingWrite?: () => Promise<void>
}

function credentialNamespace(input: CredentialScope) {
  const profileIdentity = createHash('sha256').update(input.profileName).digest('hex')
  const destinationIdentity = createHash('sha256')
    .update(
      JSON.stringify([
        input.destination.kind,
        destinationPath(input.destination, input.profileName),
      ]),
    )
    .digest('hex')
  return {
    profileIdentity,
    prefix: `${profileIdentity}.${destinationIdentity}.`,
  }
}

function decodePendingCredential(
  destination: ProfileCredentialDestination,
  content: Buffer,
  location: string,
) {
  try {
    if (
      destination.kind === 'credential-store' &&
      isLocalSessionProfileCredential(content.toString('utf8').trim())
    ) {
      throw new Error('A plaintext credential cannot be recovered into the platform store.')
    }
    const credential = decodeCredentialContent(destination, content)
    validateProfileCredential(credential)
    return credential
  } catch (cause) {
    throw new ProfileCredentialPendingRecoveryError(location, { cause })
  }
}

async function legacyCandidates(input: CredentialScope, profileIdentity: string) {
  const names = await listOwnedFiles(input.stagingDirectory, `${profileIdentity}.`, '.pending')
  const compatible: string[] = []
  for (const name of names) {
    if (name.split('.').length !== LEGACY_PENDING_NAME_COMPONENTS) continue
    const file = await readOwnedFile(input.stagingDirectory, name)
    if (file.content === undefined) continue
    const location = path.join(input.stagingDirectory, name)
    // Legacy file names do not bind the credential to its original target path.
    // Even an exact-key retry cannot prove that the caller chose the same file.
    if (input.destination.kind === 'file') {
      throw new ProfileCredentialPendingRecoveryError(location)
    }
    if (
      input.destination.kind === 'credential-store' &&
      isLocalSessionProfileCredential(file.content.toString('utf8').trim())
    )
      continue
    decodePendingCredential(input.destination, file.content, location)
    compatible.push(name)
  }
  return compatible
}

async function pendingCandidates(input: CredentialScope, prefix: string, profileIdentity: string) {
  return [
    ...(await listOwnedFiles(input.stagingDirectory, prefix, '.pending')),
    ...(await legacyCandidates(input, profileIdentity)),
  ]
}

/** Successful local installation excludes the same protected bytes from later foreign adoption. */
export async function markInstalledPendingCredentials(
  input: CredentialScope & { credential: string },
) {
  if (input.destination.kind !== 'credential-store') return
  const { profileIdentity, prefix } = credentialNamespace(input)
  for (const name of await pendingCandidates(input, prefix, profileIdentity)) {
    const sourceLocation = path.join(input.stagingDirectory, name)
    const pending = await readOwnedFile(input.stagingDirectory, name)
    if (!pending.content || !pending.fileIdentity) continue
    if (
      decodePendingCredential(input.destination, pending.content, sourceLocation) !==
      input.credential
    ) {
      continue
    }
    await markConsumedPending(input, prefix, name, pending.fileIdentity)
  }
}

async function readOwnPending(
  input: CredentialStagingInput,
  scopedName: string,
  legacyName: string,
) {
  const scoped = await readOwnedFile(input.stagingDirectory, scopedName)
  if (scoped.content !== undefined) return { temporaryName: scopedName, pendingFile: scoped }
  const legacy = await readOwnedFile(input.stagingDirectory, legacyName)
  if (legacy.content !== undefined && input.destination.kind === 'file') {
    throw new ProfileCredentialPendingRecoveryError(path.join(input.stagingDirectory, legacyName))
  }
  return legacy.content !== undefined
    ? { temporaryName: legacyName, pendingFile: legacy }
    : { temporaryName: scopedName, pendingFile: scoped }
}

async function foreignPendingName(
  input: CredentialStagingInput,
  prefix: string,
  profileIdentity: string,
  ownName: string,
) {
  const installedCredential = await installedStoreCredential(input)
  const foreign: { name: string; fileIdentity: string }[] = []
  for (const name of await pendingCandidates(input, prefix, profileIdentity)) {
    if (name === ownName) continue
    const sourceLocation = path.join(input.stagingDirectory, name)
    const pending = await readOwnedFile(input.stagingDirectory, name)
    if (!pending.content || !pending.fileIdentity) continue
    const credential = decodePendingCredential(input.destination, pending.content, sourceLocation)
    if (await isConsumedPending(input, prefix, name, pending.fileIdentity)) continue
    if (installedCredential === credential) {
      await markConsumedPending(input, prefix, name, pending.fileIdentity)
      continue
    }
    foreign.push({ name, fileIdentity: pending.fileIdentity })
  }
  if (foreign.length > 1) {
    throw new Error(
      `Multiple protected credential recovery artifacts require manual cleanup in ${input.stagingDirectory}.`,
    )
  }
  return foreign[0]
}

async function copyForeignPending(
  input: CredentialStagingInput,
  foreign: { name: string; fileIdentity: string },
  ownName: string,
  prefix: string,
) {
  const sourceLocation = path.join(input.stagingDirectory, foreign.name)
  try {
    const source = await readOwnedFile(input.stagingDirectory, foreign.name)
    if (!source.content || source.fileIdentity !== foreign.fileIdentity) {
      throw new Error('The protected credential changed during recovery.')
    }
    const credential = decodePendingCredential(input.destination, source.content, sourceLocation)
    const sourceWasInstalled = async () => {
      if (await isConsumedPending(input, prefix, foreign.name, foreign.fileIdentity)) return true
      if ((await installedStoreCredential(input)) !== credential) return false
      await markConsumedPending(input, prefix, foreign.name, foreign.fileIdentity)
      return true
    }
    if (await sourceWasInstalled()) {
      throw new Error('The protected credential was installed during recovery.')
    }
    const copyHandle = await openUnlinkedCredentialSource(source.content)
    try {
      await writeOwnedFile({
        directory: input.stagingDirectory,
        name: ownName,
        sourceHandle: copyHandle,
        ...(input.beforeStagingWrite ? { beforeOperation: input.beforeStagingWrite } : {}),
      })
    } catch (writeError) {
      const racedCopy = await readOwnedFile(input.stagingDirectory, ownName)
      if (racedCopy.content === undefined) throw writeError
    } finally {
      await copyHandle.close()
    }
    const copy = await readOwnedFile(input.stagingDirectory, ownName)
    if (copy.content?.equals(source.content) && copy.fileIdentity) {
      const currentSource = await readOwnedFile(input.stagingDirectory, foreign.name)
      if (currentSource.fileIdentity !== foreign.fileIdentity) {
        await markConsumedPending(input, prefix, ownName, copy.fileIdentity)
        throw new Error('The protected credential changed during recovery.')
      }
      if (await sourceWasInstalled()) {
        await markConsumedPending(input, prefix, ownName, copy.fileIdentity)
        throw new Error('The protected credential was installed during recovery.')
      }
    }
    return copy
  } catch (cause) {
    throw new ProfileCredentialPendingRecoveryError(sourceLocation, { cause })
  }
}

async function createFreshPending(input: CredentialStagingInput, temporaryName: string) {
  await input.beforeCreate?.()
  const contentHandle = await openUnlinkedCredentialSource(
    credentialContent(input.destination, input.credential),
  )
  try {
    await writeOwnedFile({
      directory: input.stagingDirectory,
      name: temporaryName,
      sourceHandle: contentHandle,
      ...(input.beforeStagingWrite ? { beforeOperation: input.beforeStagingWrite } : {}),
    })
    return false
  } catch (error) {
    const racedFile = await readOwnedFile(input.stagingDirectory, temporaryName)
    if (!racedFile.content) throw error
    return true
  } finally {
    await contentHandle.close()
  }
}

export async function preparePendingCredential(input: CredentialStagingInput) {
  const { profileIdentity, prefix } = credentialNamespace(input)
  const scopedName = `${prefix}${input.stagingIdentity}.pending`
  const legacyName = `${profileIdentity}.${input.stagingIdentity}.pending`
  const own = await readOwnPending(input, scopedName, legacyName)
  const temporaryName = own.temporaryName
  let pendingFile = own.pendingFile
  let recoveredPending = pendingFile.content !== undefined
  if (pendingFile.content === undefined && input.recoverAnyPending) {
    const foreign = await foreignPendingName(input, prefix, profileIdentity, temporaryName)
    if (foreign) {
      pendingFile = await copyForeignPending(input, foreign, temporaryName, prefix)
      recoveredPending = true
    }
  }
  if (!pendingFile.content) {
    recoveredPending = await createFreshPending(input, temporaryName)
  }
  pendingFile = await readOwnedFile(input.stagingDirectory, temporaryName)
  if (!pendingFile.content || !pendingFile.fileIdentity) {
    throw new Error('Credential staging produced no recoverable content or file identity.')
  }
  const selectedCredential = decodePendingCredential(
    input.destination,
    pendingFile.content,
    path.join(input.stagingDirectory, temporaryName),
  )
  return {
    temporaryName,
    selectedCredential,
    stagedContent: pendingFile.content,
    pendingIdentity: pendingFile.fileIdentity,
    recoveredPending,
  }
}
