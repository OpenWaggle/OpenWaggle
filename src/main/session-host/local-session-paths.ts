import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DATABASE_FILE_NAME } from '../services/database-constants'
import { secureWindowsUserOnly, type WindowsUserOnlySecurity } from './windows-user-only-security'

const PORTABLE_UNIX_SOCKET_PATH_BYTES = 100
const ENDPOINT_HASH_CHARACTERS = 20
const WINDOWS_ENDPOINT_CAPABILITY_BYTES = 32
const WINDOWS_ENDPOINT_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/
const WINDOWS_ENDPOINT_CAPABILITY_FILE = 'endpoint.capability'
const OWNER_DIRECTORY_MODE = 0o700
const OWNER_FILE_MODE = 0o600
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
  readonly endpointCapabilityPath: string | null
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
      endpoint: '',
      endpointDirectory: null,
      endpointCapabilityPath: path.join(stateRoot, WINDOWS_ENDPOINT_CAPABILITY_FILE),
    }
  }

  const preferredEndpoint = path.join(stateRoot, 'host.sock')
  if (Buffer.byteLength(preferredEndpoint, 'utf8') <= PORTABLE_UNIX_SOCKET_PATH_BYTES) {
    return {
      stateRoot,
      legacyDatabasePath,
      databasePath,
      recoveryDatabasePath,
      credentialPath,
      endpoint: preferredEndpoint,
      endpointDirectory: stateRoot,
      endpointCapabilityPath: null,
    }
  }

  const endpointDirectoryName = `owsh-${hash}`
  const endpointName = 'host.sock'
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
    endpointCapabilityPath: null,
  }
}

function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code
}

async function readWindowsEndpointCapability(capabilityPath: string) {
  const capability = (await fs.readFile(capabilityPath, 'utf8')).trim()
  if (!WINDOWS_ENDPOINT_CAPABILITY_PATTERN.test(capability)) {
    throw new Error('The Windows Local Session endpoint capability is invalid.')
  }
  return capability
}

function withWindowsEndpoint(paths: LocalSessionHostPaths, capability: string) {
  return {
    ...paths,
    endpoint: `\\\\.\\pipe\\openwaggle-${capability}-session-host`,
  }
}

async function writeProtectedWindowsEndpointCapability(
  capabilityPath: string,
  capability: string,
  secureUserOnly: WindowsUserOnlySecurity,
) {
  const temporaryPath = path.join(
    path.dirname(capabilityPath),
    `.${path.basename(capabilityPath)}.${randomUUID()}.tmp`,
  )
  try {
    await fs.writeFile(temporaryPath, `${capability}\n`, {
      encoding: 'utf8',
      mode: OWNER_FILE_MODE,
      flag: 'wx',
    })
    await secureUserOnly([{ kind: 'file', path: temporaryPath }])
    return temporaryPath
  } catch (error) {
    await fs.unlink(temporaryPath).catch((cleanupError: unknown) => {
      if (!hasErrorCode(cleanupError, 'ENOENT')) {
        throw new AggregateError(
          [error, cleanupError],
          'Windows endpoint capability creation and cleanup both failed.',
        )
      }
    })
    throw error
  }
}

async function ensureWindowsEndpointCapability(
  capabilityPath: string,
  secureUserOnly: WindowsUserOnlySecurity,
) {
  try {
    return await readWindowsEndpointCapability(capabilityPath)
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
  }
  const capability = randomBytes(WINDOWS_ENDPOINT_CAPABILITY_BYTES).toString('base64url')
  let temporaryPath = ''
  try {
    temporaryPath = await writeProtectedWindowsEndpointCapability(
      capabilityPath,
      capability,
      secureUserOnly,
    )
    try {
      await fs.link(temporaryPath, capabilityPath)
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error
    }
    return await readWindowsEndpointCapability(capabilityPath)
  } finally {
    if (temporaryPath) {
      await fs.unlink(temporaryPath).catch((error: unknown) => {
        if (!hasErrorCode(error, 'ENOENT')) throw error
      })
    }
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

export async function prepareLocalSessionHostPaths(
  paths: LocalSessionHostPaths,
  platform: NodeJS.Platform = process.platform,
  secureUserOnly: WindowsUserOnlySecurity = secureWindowsUserOnly,
): Promise<LocalSessionHostPaths> {
  if (platform === 'win32') {
    const capabilityPath = paths.endpointCapabilityPath
    if (!capabilityPath) {
      throw new Error('The Windows Local Session endpoint capability path is unavailable.')
    }
    await fs.mkdir(paths.stateRoot, { recursive: true, mode: OWNER_DIRECTORY_MODE })
    await fs.chmod(paths.stateRoot, OWNER_DIRECTORY_MODE)
    await secureUserOnly([{ kind: 'directory', path: paths.stateRoot }])
    const capability = await ensureWindowsEndpointCapability(capabilityPath, secureUserOnly)
    await fs.chmod(capabilityPath, OWNER_FILE_MODE)
    await secureUserOnly([{ kind: 'file', path: capabilityPath }])
    return withWindowsEndpoint(paths, capability)
  }
  await prepareUnixOwnerDirectory(paths.stateRoot, 'Local Session state directory')
  if (paths.endpointDirectory && paths.endpointDirectory !== paths.stateRoot) {
    await prepareUnixOwnerDirectory(paths.endpointDirectory, 'Local Session endpoint directory')
  }
  return paths
}

export async function refreshLocalSessionHostEndpoint(
  paths: LocalSessionHostPaths,
  platform: NodeJS.Platform = process.platform,
): Promise<LocalSessionHostPaths> {
  if (platform !== 'win32') return paths
  const capabilityPath = paths.endpointCapabilityPath
  if (!capabilityPath) {
    throw new Error('The Windows Local Session endpoint capability path is unavailable.')
  }
  return withWindowsEndpoint(paths, await readWindowsEndpointCapability(capabilityPath))
}

export async function rotateLocalSessionHostEndpoint(
  paths: LocalSessionHostPaths,
  platform: NodeJS.Platform = process.platform,
  secureUserOnly: WindowsUserOnlySecurity = secureWindowsUserOnly,
): Promise<LocalSessionHostPaths> {
  if (platform !== 'win32') return paths
  const capabilityPath = paths.endpointCapabilityPath
  if (!capabilityPath) {
    throw new Error('The Windows Local Session endpoint capability path is unavailable.')
  }
  const capability = randomBytes(WINDOWS_ENDPOINT_CAPABILITY_BYTES).toString('base64url')
  const temporaryPath = await writeProtectedWindowsEndpointCapability(
    capabilityPath,
    capability,
    secureUserOnly,
  )
  try {
    await fs.rename(temporaryPath, capabilityPath)
    await secureUserOnly([{ kind: 'file', path: capabilityPath }])
  } catch (error) {
    await fs.unlink(temporaryPath).catch((cleanupError: unknown) => {
      if (!hasErrorCode(cleanupError, 'ENOENT')) {
        throw new AggregateError(
          [error, cleanupError],
          'Windows endpoint capability rotation and cleanup both failed.',
        )
      }
    })
    throw error
  }
  return withWindowsEndpoint(paths, capability)
}
