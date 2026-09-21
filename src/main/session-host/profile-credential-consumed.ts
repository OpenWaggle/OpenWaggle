import { createHash } from 'node:crypto'
import path from 'node:path'
import type { ProfileCredentialDestination } from './profile-credential-destination'
import { ProfileCredentialPendingRecoveryError } from './profile-credential-destination-errors'
import {
  decodeCredentialContent,
  destinationPath,
  openUnlinkedCredentialSource,
} from './profile-credential-destination-support'
import { readOwnedFile, writeOwnedFile } from './profile-credential-owned-files'
import { validateProfileCredential } from './profile-credential-storage'

const CONSUMED_MARKER_CONTENT = 'foreign-ineligible\n'

export interface CredentialScope {
  readonly destination: ProfileCredentialDestination
  readonly profileName: string
  readonly stagingDirectory: string
}

function consumedMarkerName(prefix: string, sourceName: string, sourceIdentity: string) {
  const identity = createHash('sha256')
    .update(JSON.stringify([sourceName, sourceIdentity]))
    .digest('hex')
  return `${prefix}${identity}.consumed`
}

export async function isConsumedPending(
  input: CredentialScope,
  prefix: string,
  sourceName: string,
  sourceIdentity: string,
) {
  const sourceLocation = path.join(input.stagingDirectory, sourceName)
  try {
    const marker = await readOwnedFile(
      input.stagingDirectory,
      consumedMarkerName(prefix, sourceName, sourceIdentity),
    )
    if (marker.content === undefined) return false
    if (marker.content.toString('utf8') !== CONSUMED_MARKER_CONTENT) {
      throw new Error('The credential recovery marker is invalid.')
    }
    return true
  } catch (cause) {
    throw new ProfileCredentialPendingRecoveryError(sourceLocation, { cause })
  }
}

export async function markConsumedPending(
  input: CredentialScope,
  prefix: string,
  sourceName: string,
  sourceIdentity: string,
) {
  if (await isConsumedPending(input, prefix, sourceName, sourceIdentity)) return
  const sourceLocation = path.join(input.stagingDirectory, sourceName)
  const markerName = consumedMarkerName(prefix, sourceName, sourceIdentity)
  const markerHandle = await openUnlinkedCredentialSource(CONSUMED_MARKER_CONTENT).catch(
    (cause) => {
      throw new ProfileCredentialPendingRecoveryError(sourceLocation, { cause })
    },
  )
  try {
    try {
      await writeOwnedFile({
        directory: input.stagingDirectory,
        name: markerName,
        sourceHandle: markerHandle,
      })
    } catch (cause) {
      if (!(await isConsumedPending(input, prefix, sourceName, sourceIdentity))) {
        throw new ProfileCredentialPendingRecoveryError(sourceLocation, { cause })
      }
    }
  } finally {
    await markerHandle.close()
  }
}

export async function installedStoreCredential(input: CredentialScope) {
  if (input.destination.kind !== 'credential-store') return undefined
  const targetPath = destinationPath(input.destination, input.profileName)
  const installed = await readOwnedFile(path.dirname(targetPath), path.basename(targetPath))
  if (!installed.content) return undefined
  const credential = decodeCredentialContent(input.destination, installed.content)
  validateProfileCredential(credential)
  return credential
}
