import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { DATABASE_FILE_NAME } from '../services/database-constants'

const PORTABLE_UNIX_SOCKET_PATH_BYTES = 100
const ENDPOINT_HASH_CHARACTERS = 20
const OWNER_DIRECTORY_MODE = 0o700
const PORTABLE_TEMPORARY_ROOT = '/tmp'
const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_DIRECTORY_NO_FOLLOW =
  filesystemConstants.O_RDONLY |
  (filesystemConstants.O_DIRECTORY ?? 0) |
  (filesystemConstants.O_NOFOLLOW ?? 0)

export interface LocalSessionHostPaths {
  readonly stateRoot: string
  readonly legacyDatabasePath: string
  readonly databasePath: string
  readonly recoveryDatabasePath: string
  readonly credentialPath: string
  readonly endpoint: string
  readonly endpointDirectory: string | null
}

function endpointHash(userDataRoot: string) {
  return createHash('sha256')
    .update(path.resolve(userDataRoot))
    .digest('hex')
    .slice(0, ENDPOINT_HASH_CHARACTERS)
}

export function resolveLocalSessionHostPaths(input: {
  readonly userDataRoot: string
  readonly platform?: NodeJS.Platform
  readonly temporaryRoot?: string
}): LocalSessionHostPaths {
  const platform = input.platform ?? process.platform
  const stateRoot = path.join(input.userDataRoot, 'session-host')
  const legacyDatabasePath = path.join(input.userDataRoot, DATABASE_FILE_NAME)
  const databasePath = path.join(stateRoot, 'session-host.sqlite')
  const recoveryDatabasePath = path.join(stateRoot, 'pre-cutover-openwaggle.sqlite')
  const credentialPath = path.join(stateRoot, 'local-user.credential')
  const hash = endpointHash(input.userDataRoot)
  if (platform === 'win32') {
    return {
      stateRoot,
      legacyDatabasePath,
      databasePath,
      recoveryDatabasePath,
      credentialPath,
      endpoint: `\\\\.\\pipe\\openwaggle-${hash}-v${LOCAL_SESSION_CURRENT_REVISION}`,
      endpointDirectory: null,
    }
  }

  const preferredEndpoint = path.join(stateRoot, `host-v${LOCAL_SESSION_CURRENT_REVISION}.sock`)
  if (Buffer.byteLength(preferredEndpoint, 'utf8') <= PORTABLE_UNIX_SOCKET_PATH_BYTES) {
    return {
      stateRoot,
      legacyDatabasePath,
      databasePath,
      recoveryDatabasePath,
      credentialPath,
      endpoint: preferredEndpoint,
      endpointDirectory: stateRoot,
    }
  }

  const endpointDirectoryName = `owsh-${hash}`
  const endpointName = `v${LOCAL_SESSION_CURRENT_REVISION}.sock`
  const temporaryEndpointDirectory = path.join(
    input.temporaryRoot ?? os.tmpdir(),
    endpointDirectoryName,
  )
  const temporaryEndpoint = path.join(temporaryEndpointDirectory, endpointName)
  const endpointDirectory =
    Buffer.byteLength(temporaryEndpoint, 'utf8') <= PORTABLE_UNIX_SOCKET_PATH_BYTES
      ? temporaryEndpointDirectory
      : path.join(PORTABLE_TEMPORARY_ROOT, endpointDirectoryName)
  return {
    stateRoot,
    legacyDatabasePath,
    databasePath,
    recoveryDatabasePath,
    credentialPath,
    endpoint: path.join(endpointDirectory, endpointName),
    endpointDirectory,
  }
}

async function prepareUnixOwnerDirectory(directory: string, label: string) {
  if (
    filesystemConstants.O_DIRECTORY === undefined ||
    filesystemConstants.O_NOFOLLOW === undefined ||
    process.getuid === undefined
  ) {
    throw new Error(`${label} cannot be prepared without Unix owner and no-follow support.`)
  }
  await fs.mkdir(directory, { recursive: true, mode: OWNER_DIRECTORY_MODE })
  let handle: Awaited<ReturnType<typeof fs.open>>
  try {
    handle = await fs.open(directory, OPEN_DIRECTORY_NO_FOLLOW)
  } catch (cause) {
    throw new Error(`${label} must be a real directory owned by the current user.`, { cause })
  }
  try {
    const stats = await handle.stat()
    if (!stats.isDirectory()) {
      throw new Error(`${label} must be a directory.`)
    }
    if (stats.uid !== process.getuid()) {
      throw new Error(`${label} must be owned by the current user.`)
    }
    await handle.chmod(OWNER_DIRECTORY_MODE)
  } finally {
    await handle.close()
  }
}

export async function prepareLocalSessionHostPaths(paths: LocalSessionHostPaths): Promise<void> {
  if (process.platform === 'win32') {
    await fs.mkdir(paths.stateRoot, { recursive: true, mode: OWNER_DIRECTORY_MODE })
    await fs.chmod(paths.stateRoot, OWNER_DIRECTORY_MODE)
    return
  }
  await prepareUnixOwnerDirectory(paths.stateRoot, 'Local Session state directory')
  if (paths.endpointDirectory && paths.endpointDirectory !== paths.stateRoot) {
    await prepareUnixOwnerDirectory(paths.endpointDirectory, 'Local Session endpoint directory')
  }
}
