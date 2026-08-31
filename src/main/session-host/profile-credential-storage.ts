import { createHash } from 'node:crypto'
import { readdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'

const PROFILE_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/

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
  const credential = (await readFile(path.resolve(filePath), 'utf8')).trim()
  validateProfileCredential(credential)
  return credential
}

export function removeStoredProfileCredential(input: {
  readonly stateRoot: string
  readonly profileName: string
}) {
  const profileIdentity = createHash('sha256').update(input.profileName).digest('hex')
  const receipts = path.join(input.stateRoot, 'profile-credential-receipts')
  return Promise.all([
    unlink(storedProfileCredentialPath(input.stateRoot, input.profileName)).catch(() => undefined),
    readdir(receipts)
      .then((entries) =>
        Promise.all(
          entries
            .filter((entry) => entry.startsWith(`${profileIdentity}.`))
            .map((entry) => unlink(path.join(receipts, entry)).catch(() => undefined)),
        ),
      )
      .catch(() => undefined),
  ]).then(() => undefined)
}
