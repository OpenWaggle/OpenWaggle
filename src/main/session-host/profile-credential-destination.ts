import { createHash, randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import path from 'node:path'
import { ensureDirectoryPathPinned } from '../utils/pinned-directory-creation'
import {
  installCredentialInBoundDirectory,
  ProfileCredentialInstallerRecoveryError,
} from './profile-credential-bound-installer'
import {
  ProfileCredentialCleanupError,
  ProfileCredentialCommitError,
} from './profile-credential-destination-errors'
import {
  credentialFingerprint,
  destinationMetadata,
  destinationPath,
  openUnlinkedCredentialSource,
  ownerStateRoot,
  parseReceipt,
  receiptPath,
  recoverInstalledCredential,
} from './profile-credential-destination-support'
import { readOwnedFile, unlinkOwnedFile, writeOwnedFile } from './profile-credential-owned-files'
import {
  markInstalledPendingCredentials,
  preparePendingCredential,
} from './profile-credential-pending'
import {
  validateCredentialDestination,
  validateStagedCredentialDestination,
} from './profile-credential-preflight'
import { validateProfileCredential } from './profile-credential-storage'

export {
  readProfileCredentialFile,
  readStoredProfileCredential,
  removeStoredProfileCredential,
} from './profile-credential-storage'
export { ProfileCredentialCleanupError, ProfileCredentialCommitError }

const OWNER_DIRECTORY_MODE = 0o700

export type ProfileCredentialDestination =
  | { readonly kind: 'credential-store'; readonly stateRoot: string }
  | { readonly kind: 'file'; readonly path: string }

export interface ProfileCredentialDestinationMetadata {
  readonly kind: ProfileCredentialDestination['kind']
  readonly location: string
}

function validateCredential(credential: string) {
  validateProfileCredential(credential)
}

async function readDestinationDirectoryIdentity(targetPath: string) {
  const handle = await open(path.dirname(targetPath), 'r')
  try {
    const stats = await handle.stat()
    return `${stats.dev}:${stats.ino}`
  } finally {
    await handle.close()
  }
}

async function persistCredentialReceipt(input: {
  readonly receiptDirectory: string
  readonly installedReceiptPath: string
  readonly targetPath: string
  readonly selectedCredential: string
  readonly directoryIdentity: string
  readonly beforeReceiptMutation?: () => Promise<void>
}) {
  const receiptHandle = await openUnlinkedCredentialSource(
    JSON.stringify({
      targetPath: input.targetPath,
      fingerprint: credentialFingerprint(input.selectedCredential),
      directoryIdentity: input.directoryIdentity,
    }),
  )
  try {
    await writeOwnedFile({
      directory: input.receiptDirectory,
      name: path.basename(input.installedReceiptPath),
      sourceHandle: receiptHandle,
      ...(input.beforeReceiptMutation ? { beforeOperation: input.beforeReceiptMutation } : {}),
    })
  } catch (error) {
    const receipt = await readOwnedFile(
      input.receiptDirectory,
      path.basename(input.installedReceiptPath),
    )
    if (!receipt.content) throw error
    const existing = parseReceipt(JSON.parse(receipt.content.toString('utf8')), input.targetPath)
    if (
      existing.directoryIdentity !== input.directoryIdentity ||
      existing.fingerprint !== credentialFingerprint(input.selectedCredential)
    ) {
      throw new Error('A conflicting credential installation receipt already exists.', {
        cause: error,
      })
    }
  } finally {
    await receiptHandle.close()
  }
}

interface ProfileCredentialStagingOptions {
  readonly destination: ProfileCredentialDestination
  readonly stateRoot?: string
  readonly profileName: string
  readonly credential: string
  readonly replace: boolean
  readonly stagingKey?: string
  readonly recoverAnyPending?: boolean
  /** Test-only interleaving point after the destination helper pins its cwd. */
  readonly beforeCommitMutation?: () => Promise<void>
  /** Test-only failure/interleaving point after installation and before receipt persistence. */
  readonly beforeReceiptWrite?: () => Promise<void>
  readonly beforeStagingWrite?: () => Promise<void>
  readonly beforeReceiptMutation?: () => Promise<void>
}

function markInstalledCredential(
  input: ProfileCredentialStagingOptions,
  stagingDirectory: string,
  credential: string,
) {
  return markInstalledPendingCredentials({
    destination: input.destination,
    profileName: input.profileName,
    stagingDirectory,
    credential,
  })
}

async function recoverCommittedCredential(input: {
  readonly staging: ProfileCredentialStagingOptions
  readonly stagingDirectory: string
  readonly targetPath: string
  readonly receiptPath: string
}) {
  if (!input.staging.stagingKey) return
  const credential = await recoverInstalledCredential({
    destination: input.staging.destination,
    targetPath: input.targetPath,
    receiptPath: input.receiptPath,
  })
  if (credential) await markInstalledCredential(input.staging, input.stagingDirectory, credential)
  return credential
}

function credentialCommitFailure(cause: unknown, temporaryPath: string) {
  const additionalRecoveryLocations =
    cause instanceof ProfileCredentialInstallerRecoveryError ? cause.recoveryLocations : []
  return new ProfileCredentialCommitError(
    `Credential installation did not finish. The protected credential remains recoverable at ${temporaryPath}.` +
      (additionalRecoveryLocations.length > 0
        ? ` Protected installer artifacts may also remain at ${additionalRecoveryLocations.join(' and ')}.`
        : ''),
    temporaryPath,
    { cause },
    additionalRecoveryLocations,
  )
}

export async function stageProfileCredential(input: ProfileCredentialStagingOptions) {
  validateCredential(input.credential)
  const targetPath = destinationPath(input.destination, input.profileName)
  const stateRoot = ownerStateRoot(input.destination, input.stateRoot)
  await ensureDirectoryPathPinned({
    targetDirectory: path.dirname(targetPath),
    mode: OWNER_DIRECTORY_MODE,
  })
  const directoryIdentity = await readDestinationDirectoryIdentity(targetPath)
  const stagingIdentity = input.stagingKey
    ? createHash('sha256').update(input.stagingKey).digest('hex')
    : randomUUID()
  const installedReceiptPath = receiptPath(stateRoot, input.profileName, stagingIdentity)
  const receiptDirectory = path.dirname(installedReceiptPath)
  await ensureDirectoryPathPinned({
    targetDirectory: receiptDirectory,
    mode: OWNER_DIRECTORY_MODE,
  })
  const stagingDirectory = path.join(stateRoot, 'profile-credential-staging')
  await ensureDirectoryPathPinned({ targetDirectory: stagingDirectory, mode: OWNER_DIRECTORY_MODE })
  const installedCredential = await recoverCommittedCredential({
    staging: input,
    stagingDirectory,
    targetPath,
    receiptPath: installedReceiptPath,
  })
  if (installedCredential) {
    return {
      credential: installedCredential,
      metadata: destinationMetadata(input.destination, input.profileName, targetPath),
      recoveryLocation: targetPath,
      recoveredPending: false,
      commit: async () => undefined,
      discard: async () => undefined,
    }
  }
  const pending = await preparePendingCredential({
    destination: input.destination,
    profileName: input.profileName,
    credential: input.credential,
    stagingIdentity,
    stagingDirectory,
    beforeCreate: async () => {
      await validateCredentialDestination({
        destination: input.destination,
        targetPath,
        selectedCredential: input.credential,
        replace: input.replace,
      })
    },
    ...(input.recoverAnyPending ? { recoverAnyPending: true } : {}),
    ...(input.beforeStagingWrite ? { beforeStagingWrite: input.beforeStagingWrite } : {}),
  })
  const temporaryPath = path.join(stagingDirectory, pending.temporaryName)
  const { stagedDestinationIdentity, alreadyInstalled } = await validateStagedCredentialDestination(
    {
      destination: input.destination,
      targetPath,
      selectedCredential: pending.selectedCredential,
      replace: input.replace,
      stagingDirectory,
      temporaryName: pending.temporaryName,
    },
  )
  return {
    credential: pending.selectedCredential,
    metadata: destinationMetadata(input.destination, input.profileName, targetPath),
    recoveryLocation: temporaryPath,
    recoveredPending: pending.recoveredPending,
    commit: async () => {
      const sourceHandle = await openUnlinkedCredentialSource(pending.stagedContent)
      try {
        if (!alreadyInstalled) {
          await installCredentialInBoundDirectory({
            directory: path.dirname(targetPath),
            directoryIdentity,
            targetName: path.basename(targetPath),
            mode: stagedDestinationIdentity ? 'replace' : 'create',
            ...(stagedDestinationIdentity
              ? {
                  expectedIdentity: `${stagedDestinationIdentity.device}:${stagedDestinationIdentity.inode}`,
                  expectedDigest: stagedDestinationIdentity.contentHash,
                }
              : {}),
            sourceHandle,
            ...(input.beforeCommitMutation ? { beforeMutation: input.beforeCommitMutation } : {}),
          })
        }
        await markInstalledCredential(input, stagingDirectory, pending.selectedCredential)
        await input.beforeReceiptWrite?.()
        await persistCredentialReceipt({
          receiptDirectory,
          installedReceiptPath,
          targetPath,
          selectedCredential: pending.selectedCredential,
          directoryIdentity,
          ...(input.beforeReceiptMutation
            ? { beforeReceiptMutation: input.beforeReceiptMutation }
            : {}),
        })
        await unlinkOwnedFile(stagingDirectory, pending.temporaryName, pending.pendingIdentity)
      } catch (cause) {
        throw credentialCommitFailure(cause, temporaryPath)
      } finally {
        await sourceHandle.close()
      }
    },
    discard: async () => {
      try {
        await unlinkOwnedFile(stagingDirectory, pending.temporaryName, pending.pendingIdentity)
      } catch (cause) {
        throw new ProfileCredentialCleanupError(temporaryPath, { cause })
      }
    },
  }
}
