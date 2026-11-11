import { createHash } from 'node:crypto'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { createConnection, createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  SecondInstanceLaunch,
  SystemIntegrationShape,
} from '../../ports/desktop-shell/system-integration'
import type { Unsubscribe } from '../../ports/desktop-shell/shell-events'
import { createLogger } from '../../logger'

/**
 * One running instance per `userData` (ADR 0064 native helper; Electrobun has no
 * `requestSingleInstanceLock`). The lock is a file in `userData` created exclusively and holding
 * the owner's process id; a lock whose owner is gone is taken over. The owner listens on a Unix
 * socket (a named pipe on Windows) derived from `userData`, and a later launch that loses the
 * lock sends it its argv, working directory and data there, as Electron's `second-instance` does.
 *
 * Costs and risks: a reused process id makes a stale lock look held until that process ends;
 * two launches racing over the same stale lock within microseconds could both take it. The
 * forwarded launch is delivered asynchronously, so a losing launch keeps its quit open
 * (`pendingForwardedLaunch`) until the owner has read it or a short deadline passes.
 */
const LOCK_FILE = 'openwaggle-instance.lock'
const FORWARD_DEADLINE_MS = 2_000
const SOCKET_HASH_LENGTH = 16
const DECIMAL = 10

const logger = createLogger('electrobun/single-instance')

interface InstanceLockState {
  owned: string | null
  server: Server | null
  forwarding: Promise<void> | null
  readonly listeners: Set<(launch: SecondInstanceLaunch) => void>
}

const state: InstanceLockState = {
  owned: null,
  server: null,
  forwarding: null,
  listeners: new Set(),
}

/** The socket or pipe of the instance owning `userData`; macOS caps socket paths at 104 bytes. */
export function instanceSocketPath(userData: string, platform = process.platform) {
  const hash = createHash('sha256').update(userData).digest('hex').slice(0, SOCKET_HASH_LENGTH)
  return platform === 'win32'
    ? `\\\\.\\pipe\\openwaggle-${hash}`
    : path.join(tmpdir(), `openwaggle-${hash}.sock`)
}

function isRunning(pid: number) {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return Reflect.get(Object(error), 'code') === 'EPERM'
  }
}

function lockOwner(lockPath: string) {
  try {
    const pid = Number.parseInt(readFileSync(lockPath, 'utf8'), DECIMAL)
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function createLock(lockPath: string) {
  const descriptor = openSync(lockPath, 'wx')
  try {
    writeSync(descriptor, String(process.pid))
  } finally {
    closeSync(descriptor)
  }
}

/** Takes the lock file, or a stale one; false when a running instance holds it. */
function takeLock(lockPath: string) {
  mkdirSync(path.dirname(lockPath), { recursive: true })
  try {
    createLock(lockPath)
    return true
  } catch (error) {
    if (Reflect.get(Object(error), 'code') !== 'EEXIST') throw error
  }
  const owner = lockOwner(lockPath)
  if (owner !== null && owner !== process.pid && isRunning(owner)) return false
  unlinkSync(lockPath)
  createLock(lockPath)
  return true
}

/** Delivers a later launch to this instance's listeners. */
export function receiveSecondInstance(launch: SecondInstanceLaunch) {
  for (const listener of [...state.listeners]) listener(launch)
}

function parseLaunch(text: string): SecondInstanceLaunch | null {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    const argv: unknown = Reflect.get(value, 'argv')
    const workingDirectory: unknown = Reflect.get(value, 'workingDirectory')
    if (!Array.isArray(argv) || !argv.every((item) => typeof item === 'string')) return null
    if (typeof workingDirectory !== 'string') return null
    return { argv, workingDirectory, additionalData: Reflect.get(value, 'additionalData') }
  } catch {
    return null
  }
}

function listen(socketPath: string) {
  if (process.platform !== 'win32') rmSync(socketPath, { force: true })
  const server = createServer((socket) => {
    let text = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      text += chunk
    })
    socket.on('end', () => {
      const launch = parseLaunch(text)
      if (launch) receiveSecondInstance(launch)
      else logger.warn('Ignored a malformed later launch', { bytes: text.length })
      socket.end()
    })
    socket.on('error', () => socket.destroy())
  })
  server.on('error', (error) => logger.warn('Instance socket failed', { error: String(error) }))
  server.listen(socketPath)
  server.unref()
  return server
}

function forward(socketPath: string, additionalData: Record<string, string> | undefined) {
  const payload = JSON.stringify({
    argv: process.argv,
    workingDirectory: process.cwd(),
    additionalData: additionalData ?? {},
  })
  return new Promise<void>((resolve) => {
    const socket = createConnection(socketPath)
    const timer = setTimeout(() => {
      socket.destroy()
      resolve()
    }, FORWARD_DEADLINE_MS)
    const finish = () => {
      clearTimeout(timer)
      resolve()
    }
    socket.on('connect', () => socket.end(payload))
    socket.on('close', finish)
    socket.on('error', finish)
  })
}

/** While a launch that lost the lock hands itself over: settles once it did (or gave up). */
export function pendingForwardedLaunch() {
  return state.forwarding
}

export function singleInstanceLock(
  userData: () => string,
): Pick<
  SystemIntegrationShape,
  | 'requestSingleInstanceLock'
  | 'hasSingleInstanceLock'
  | 'releaseSingleInstanceLock'
  | 'onSecondInstance'
> {
  return {
    requestSingleInstanceLock: (additionalData) => {
      if (state.owned !== null) return true
      const directory = userData()
      const lockPath = path.join(directory, LOCK_FILE)
      const socketPath = instanceSocketPath(directory)
      if (!takeLock(lockPath)) {
        state.forwarding = forward(socketPath, additionalData)
        return false
      }
      state.owned = lockPath
      state.server = listen(socketPath)
      return true
    },
    hasSingleInstanceLock: () => state.owned !== null,
    releaseSingleInstanceLock: () => {
      const lockPath = state.owned
      if (lockPath === null) return
      state.owned = null
      state.server?.close()
      state.server = null
      if (lockOwner(lockPath) === process.pid) rmSync(lockPath, { force: true })
    },
    onSecondInstance: (listener): Unsubscribe => {
      state.listeners.add(listener)
      return () => {
        state.listeners.delete(listener)
      }
    },
  }
}
