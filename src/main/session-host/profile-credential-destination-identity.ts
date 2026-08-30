import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'

export interface CredentialDestinationIdentity {
  readonly device: number
  readonly inode: number
  readonly contentHash: string
}

export async function credentialDestinationIdentity(
  targetPath: string,
): Promise<CredentialDestinationIdentity | undefined> {
  try {
    const stats = await lstat(targetPath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error('Credential destination is not a regular file.')
    }
    return {
      device: stats.dev,
      inode: stats.ino,
      contentHash: createHash('sha256')
        .update(await readFile(targetPath))
        .digest('base64url'),
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

export function sameCredentialDestination(
  expected: CredentialDestinationIdentity,
  actual: CredentialDestinationIdentity | undefined,
) {
  return (
    actual?.device === expected.device &&
    actual.inode === expected.inode &&
    actual.contentHash === expected.contentHash
  )
}
