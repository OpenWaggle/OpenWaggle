import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeStorage } from 'electron'
import type {
  ProfileCredentialDestination,
  ProfileCredentialDestinationMetadata,
} from './profile-credential-destination'
import { credentialDestinationIdentity } from './profile-credential-destination-identity'
import { readOwnedFile } from './profile-credential-owned-files'
import {
  storedProfileCredentialPath,
  validateProfileCredential,
} from './profile-credential-storage'

const OWNER_FILE_MODE = 0o600

export function destinationPath(destination: ProfileCredentialDestination, profileName: string) {
  return destination.kind === 'file'
    ? path.resolve(destination.path)
    : storedProfileCredentialPath(destination.stateRoot, profileName)
}

export function destinationMetadata(
  destination: ProfileCredentialDestination,
  profileName: string,
  targetPath: string,
): ProfileCredentialDestinationMetadata {
  return {
    kind: destination.kind,
    location:
      destination.kind === 'credential-store'
        ? `OpenWaggle credential store (${profileName})`
        : targetPath,
  }
}

export function credentialContent(destination: ProfileCredentialDestination, credential: string) {
  if (destination.kind === 'file') return Buffer.from(`${credential}\n`, 'utf8')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('The platform credential store is unavailable on this machine.')
  }
  return safeStorage.encryptString(credential)
}

export function decodeCredentialContent(
  destination: ProfileCredentialDestination,
  content: Buffer,
) {
  if (destination.kind === 'file') return content.toString('utf8').trim()
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('The platform credential store is unavailable on this machine.')
  }
  return safeStorage.decryptString(content)
}

export function credentialFingerprint(credential: string) {
  return createHash('sha256').update(credential).digest('base64url')
}

export function ownerStateRoot(destination: ProfileCredentialDestination, stateRoot?: string) {
  if (destination.kind === 'credential-store') return destination.stateRoot
  if (!stateRoot)
    throw new Error('A trusted OpenWaggle state root is required for file credentials.')
  return stateRoot
}

export function receiptPath(stateRoot: string, profileName: string, stagingIdentity: string) {
  const profileIdentity = createHash('sha256').update(profileName).digest('hex')
  return path.join(
    stateRoot,
    'profile-credential-receipts',
    `${profileIdentity}.${stagingIdentity}.json`,
  )
}

export function parseReceipt(value: unknown, targetPath: string) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('targetPath' in value) ||
    value.targetPath !== targetPath ||
    !('fingerprint' in value) ||
    typeof value.fingerprint !== 'string' ||
    !('directoryIdentity' in value) ||
    typeof value.directoryIdentity !== 'string'
  ) {
    throw new Error('Credential installation receipt is invalid.')
  }
  return { fingerprint: value.fingerprint, directoryIdentity: value.directoryIdentity }
}

export async function recoverInstalledCredential(input: {
  readonly destination: ProfileCredentialDestination
  readonly targetPath: string
  readonly receiptPath: string
}) {
  const receiptFile = await readOwnedFile(
    path.dirname(input.receiptPath),
    path.basename(input.receiptPath),
  )
  if (!receiptFile.content) return undefined
  const receipt = parseReceipt(JSON.parse(receiptFile.content.toString('utf8')), input.targetPath)
  const targetFile = await readOwnedFile(
    path.dirname(input.targetPath),
    path.basename(input.targetPath),
  )
  if (!targetFile.content) return undefined
  if (targetFile.directoryIdentity !== receipt.directoryIdentity) {
    throw new Error('The credential destination directory changed after installation.')
  }
  const credential = decodeCredentialContent(input.destination, targetFile.content)
  validateProfileCredential(credential)
  if (credentialFingerprint(credential) !== receipt.fingerprint) {
    throw new Error('The credential destination changed after this idempotent operation.')
  }
  return credential
}

export async function openUnlinkedCredentialSource(content: string | Buffer) {
  const sourcePath = path.join(os.tmpdir(), `.openwaggle-credential-${randomUUID()}.source`)
  await writeFile(sourcePath, content, { mode: OWNER_FILE_MODE, flag: 'wx' })
  const handle = await open(sourcePath, 'r')
  try {
    await unlink(sourcePath)
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

export async function assertReplaceable(targetPath: string, replace: boolean) {
  try {
    const stats = await lstat(targetPath)
    if (stats.isSymbolicLink()) {
      throw new Error('Credential destination cannot be a symbolic link.')
    }
    if (!stats.isFile()) throw new Error('Credential destination is not a regular file.')
    if (!replace) {
      throw new Error('Credential destination already exists. Use --replace to update it.')
    }
    return credentialDestinationIdentity(targetPath)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}
