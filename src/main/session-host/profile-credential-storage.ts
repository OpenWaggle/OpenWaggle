import { createHash } from 'node:crypto'
import { constants as FS_CONSTANTS, type Stats } from 'node:fs'
import { lstat, open, readdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { isEnoent } from '@shared/utils/node-error'
import { safeStorage } from 'electron'

const PROFILE_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const PROFILE_CREDENTIAL_FILE_MAX_BYTES = 1024
const PROFILE_CREDENTIAL_FILE_SENTINEL_BYTES = 1
const OPEN_READ_NO_FOLLOW_NONBLOCKING =
  FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NONBLOCK | (FS_CONSTANTS.O_NOFOLLOW ?? 0)

function sameCredentialFile(left: Stats, right: Stats) {
  return left.dev === right.dev && left.ino === right.ino
}

function sameCredentialFileVersion(left: Stats, right: Stats) {
  return (
    sameCredentialFile(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function assertCredentialFile(stats: Stats) {
  if (!stats.isFile()) throw new Error('Profile credential input must be a regular file.')
  if (stats.size > PROFILE_CREDENTIAL_FILE_MAX_BYTES) {
    throw new Error('Profile credential input exceeds the 1 KiB size limit.')
  }
}

async function readBoundedCredentialFile(handle: Awaited<ReturnType<typeof open>>) {
  const bytes = Buffer.allocUnsafe(
    PROFILE_CREDENTIAL_FILE_MAX_BYTES + PROFILE_CREDENTIAL_FILE_SENTINEL_BYTES,
  )
  let bytesRead = 0
  while (bytesRead < bytes.byteLength) {
    const result = await handle.read(bytes, bytesRead, bytes.byteLength - bytesRead, bytesRead)
    if (result.bytesRead === 0) break
    bytesRead += result.bytesRead
  }
  return { bytes, bytesRead }
}

export function validateProfileCredential(credential: string) {
  if (!PROFILE_CREDENTIAL_PATTERN.test(credential)) {
    throw new Error('Restricted profile credential has an invalid encoding.')
  }
}

export function storedProfileCredentialPath(stateRoot: string, profileName: string) {
  const identity = createHash('sha256').update(profileName).digest('hex')
  return path.join(stateRoot, 'profile-credentials', `${identity}.credential`)
}

export async function readStoredProfileCredential(input: {
  readonly stateRoot: string
  readonly profileName: string
}) {
  const encrypted = await readFile(storedProfileCredentialPath(input.stateRoot, input.profileName))
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('The platform credential store is unavailable on this machine.')
  }
  const credential = safeStorage.decryptString(encrypted)
  validateProfileCredential(credential)
  return credential
}

export async function readProfileCredentialFile(filePath: string) {
  const candidate = path.resolve(filePath)
  const pathStats = await lstat(candidate)
  assertCredentialFile(pathStats)
  const handle = await open(candidate, OPEN_READ_NO_FOLLOW_NONBLOCKING)
  try {
    const openedStats = await handle.stat()
    assertCredentialFile(openedStats)
    if (!sameCredentialFileVersion(pathStats, openedStats)) {
      throw new Error('Profile credential input changed while it was being opened.')
    }
    const { bytes, bytesRead } = await readBoundedCredentialFile(handle)
    const [finalStats, finalPathStats] = await Promise.all([handle.stat(), lstat(candidate)])
    if (
      bytesRead > PROFILE_CREDENTIAL_FILE_MAX_BYTES ||
      finalStats.size > PROFILE_CREDENTIAL_FILE_MAX_BYTES
    ) {
      throw new Error('Profile credential input exceeds the 1 KiB size limit.')
    }
    if (
      bytesRead !== openedStats.size ||
      !sameCredentialFileVersion(openedStats, finalStats) ||
      !sameCredentialFileVersion(openedStats, finalPathStats)
    ) {
      throw new Error('Profile credential input changed while it was being read.')
    }
    const credential = bytes.subarray(0, bytesRead).toString('utf8').trim()
    validateProfileCredential(credential)
    return credential
  } finally {
    await handle.close()
  }
}

function ignoreMissingCredentialFile(error: unknown) {
  if (!isEnoent(error)) throw error
}

export function removeStoredProfileCredential(input: {
  readonly stateRoot: string
  readonly profileName: string
}) {
  const profileIdentity = createHash('sha256').update(input.profileName).digest('hex')
  const receipts = path.join(input.stateRoot, 'profile-credential-receipts')
  return Promise.all([
    unlink(storedProfileCredentialPath(input.stateRoot, input.profileName)).catch(
      ignoreMissingCredentialFile,
    ),
    readdir(receipts)
      .then((entries) =>
        Promise.all(
          entries
            .filter((entry) => entry.startsWith(`${profileIdentity}.`))
            .map((entry) => unlink(path.join(receipts, entry)).catch(ignoreMissingCredentialFile)),
        ),
      )
      .catch(ignoreMissingCredentialFile),
  ]).then(() => undefined)
}
