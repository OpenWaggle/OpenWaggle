import { createHash, randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import path from 'node:path'
import { ensureDirectoryPathPinned } from '../utils/pinned-directory-creation'
import { installCredentialInBoundDirectory } from './profile-credential-bound-installer'
import {
  assertReplaceable,
  credentialContent,
  credentialFingerprint,
  decodeCredentialContent,
  destinationMetadata,
  destinationPath,
  openUnlinkedCredentialSource,
  ownerStateRoot,
  parseReceipt,
  receiptPath,
  recoverInstalledCredential,
} from './profile-credential-destination-support'
import {
  listOwnedFiles,
  readOwnedFile,
  unlinkOwnedFile,
  writeOwnedFile,
} from './profile-credential-owned-files'
import { validateProfileCredential } from './profile-credential-storage'

export {
  readProfileCredentialFile,
  readStoredProfileCredential,
  removeStoredProfileCredential,
} from './profile-credential-storage'

const OWNER_DIRECTORY_MODE = 0o700

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

interface CredentialStagingInput {
  readonly destination: ProfileCredentialDestination
  readonly profileName: string
  readonly credential: string
  readonly stagingIdentity: string
  readonly stagingDirectory: string
  readonly recoverAnyPending?: boolean
  readonly beforeStagingWrite?: () => Promise<void>
}

async function preparePendingCredential(input: CredentialStagingInput) {
  const profileIdentity = createHash('sha256').update(input.profileName).digest('hex')
  let temporaryName = `${profileIdentity}.${input.stagingIdentity}.pending`
  if (input.recoverAnyPending) {
    const pending = await listOwnedFiles(input.stagingDirectory, `${profileIdentity}.`, '.pending')
    if (pending.length > 1) {
      throw new Error('Multiple protected credential recovery artifacts require manual cleanup.')
    }
    if (pending[0]) temporaryName = pending[0]
  }
  let pendingFile = await readOwnedFile(input.stagingDirectory, temporaryName)
  if (!pendingFile.content) {
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
    } catch (error) {
      pendingFile = await readOwnedFile(input.stagingDirectory, temporaryName)
      if (!pendingFile.content) throw error
    } finally {
      await contentHandle.close()
    }
  }
  pendingFile = await readOwnedFile(input.stagingDirectory, temporaryName)
  if (!pendingFile.content || !pendingFile.fileIdentity) {
    throw new Error('Credential staging produced no recoverable content or file identity.')
  }
  const selectedCredential = decodeCredentialContent(input.destination, pendingFile.content)
  validateCredential(selectedCredential)
  return {
    temporaryName,
    selectedCredential,
    stagedContent: pendingFile.content,
    pendingIdentity: pendingFile.fileIdentity,
  }
}

async function matchesInstalledCredential(input: {
  readonly destination: ProfileCredentialDestination
  readonly targetPath: string
  readonly selectedCredential: string
  readonly replace: boolean
  readonly stagedDestinationIdentity: Awaited<ReturnType<typeof assertReplaceable>>
}) {
  if (!input.stagedDestinationIdentity || input.replace) return false
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

export async function stageProfileCredential(input: {
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
}) {
  validateCredential(input.credential)
  const targetPath = destinationPath(input.destination, input.profileName)
  const stateRoot = ownerStateRoot(input.destination, input.stateRoot)
  await ensureDirectoryPathPinned({
    targetDirectory: path.dirname(targetPath),
    mode: OWNER_DIRECTORY_MODE,
  })
  const destinationDirectoryHandle = await open(path.dirname(targetPath), 'r')
  const destinationDirectoryStats = await destinationDirectoryHandle.stat()
  await destinationDirectoryHandle.close()
  const directoryIdentity = `${destinationDirectoryStats.dev}:${destinationDirectoryStats.ino}`
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
  const installedCredential = input.stagingKey
    ? await recoverInstalledCredential({
        destination: input.destination,
        targetPath,
        receiptPath: installedReceiptPath,
      })
    : undefined
  if (installedCredential) {
    return {
      credential: installedCredential,
      metadata: destinationMetadata(input.destination, input.profileName, targetPath),
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
    ...(input.recoverAnyPending ? { recoverAnyPending: true } : {}),
    ...(input.beforeStagingWrite ? { beforeStagingWrite: input.beforeStagingWrite } : {}),
  })
  const temporaryPath = path.join(stagingDirectory, pending.temporaryName)
  const stagedDestinationIdentity = await assertReplaceable(targetPath, true)
  const alreadyInstalled = await matchesInstalledCredential({
    destination: input.destination,
    targetPath,
    selectedCredential: pending.selectedCredential,
    replace: input.replace,
    stagedDestinationIdentity,
  })
  return {
    credential: pending.selectedCredential,
    metadata: destinationMetadata(input.destination, input.profileName, targetPath),
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
        throw new ProfileCredentialCommitError(
          `Credential installation did not finish. The protected credential remains recoverable at ${temporaryPath}.`,
          temporaryPath,
          { cause },
        )
      } finally {
        await sourceHandle.close()
      }
    },
    discard: () =>
      unlinkOwnedFile(stagingDirectory, pending.temporaryName, pending.pendingIdentity).catch(
        () => undefined,
      ),
  }
}
