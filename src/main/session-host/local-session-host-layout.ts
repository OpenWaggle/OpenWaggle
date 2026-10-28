/**
 * Where a profile's Session Host keeps its state and Unix socket: plain path arithmetic with no
 * OpenWaggle runtime imports, so the boot shim can find out whether a Host may already be running
 * before the main bundle loads (src/main/boot/session-host-prelaunch.ts). `local-session-paths.ts`
 * builds the full Host paths on the same layout.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { DATABASE_FILE_NAME } from '../services/database-constants'

export const SESSION_HOST_STATE_DIRECTORY = 'session-host'
export const SESSION_HOST_DATABASE_FILE = 'session-host.sqlite'
export const SESSION_HOST_SOCKET_FILE = 'host.sock'
/** The shortest Unix socket path limit among supported platforms (macOS: 104 bytes). */
const PORTABLE_UNIX_SOCKET_PATH_BYTES = 100
const PORTABLE_TEMPORARY_ROOT = '/tmp'
const ENDPOINT_HASH_CHARACTERS = 20

export function sessionHostStateRoot(userDataRoot: string) {
  return path.join(userDataRoot, SESSION_HOST_STATE_DIRECTORY)
}

export function sessionHostDatabasePath(userDataRoot: string) {
  return path.join(sessionHostStateRoot(userDataRoot), SESSION_HOST_DATABASE_FILE)
}

/** The desktop app's store from before the Session Host, which the first Host start moves. */
export function legacySessionDatabasePath(userDataRoot: string) {
  return path.join(userDataRoot, DATABASE_FILE_NAME)
}

function fitsUnixSocketPath(endpoint: string) {
  return Buffer.byteLength(endpoint, 'utf8') <= PORTABLE_UNIX_SOCKET_PATH_BYTES
}

function endpointHash(userDataRoot: string) {
  return createHash('sha256')
    .update(path.resolve(userDataRoot))
    .digest('hex')
    .slice(0, ENDPOINT_HASH_CHARACTERS)
}

export interface UnixSessionHostEndpoint {
  readonly endpoint: string
  readonly endpointDirectory: string
}

/**
 * The profile's Unix socket: in its own state directory, or, when that path is too long for a
 * socket, in a per-profile directory under the Host temp directory (`temporaryRoot`), or `/tmp`.
 */
export function unixSessionHostEndpoint(
  userDataRoot: string,
  temporaryRoot: () => string,
): UnixSessionHostEndpoint {
  const stateRoot = sessionHostStateRoot(userDataRoot)
  const preferredEndpoint = path.join(stateRoot, SESSION_HOST_SOCKET_FILE)
  if (fitsUnixSocketPath(preferredEndpoint)) {
    return { endpoint: preferredEndpoint, endpointDirectory: stateRoot }
  }
  const endpointDirectoryName = `owsh-${endpointHash(userDataRoot)}`
  const temporaryEndpointDirectory = path.join(temporaryRoot(), endpointDirectoryName)
  const endpointDirectory = fitsUnixSocketPath(
    path.join(temporaryEndpointDirectory, SESSION_HOST_SOCKET_FILE),
  )
    ? temporaryEndpointDirectory
    : path.join(PORTABLE_TEMPORARY_ROOT, endpointDirectoryName)
  return { endpoint: path.join(endpointDirectory, SESSION_HOST_SOCKET_FILE), endpointDirectory }
}
