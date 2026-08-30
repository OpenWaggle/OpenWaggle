import { chmod, lstat, unlink } from 'node:fs/promises'
import net from 'node:net'

const ENDPOINT_PROBE_TIMEOUT_MS = 250
const OWNER_SOCKET_MODE = 0o600

export function isWindowsPipe(endpoint: string) {
  return endpoint.startsWith('\\\\.\\pipe\\')
}

async function endpointExists(endpoint: string) {
  try {
    return await lstat(endpoint)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

async function canConnect(endpoint: string) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection(endpoint)
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, ENDPOINT_PROBE_TIMEOUT_MS)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

export async function prepareLocalSessionEndpoint(endpoint: string) {
  if (isWindowsPipe(endpoint)) return
  const entry = await endpointExists(endpoint)
  if (!entry) return
  if (!entry.isSocket()) {
    throw new Error(`Local Session endpoint is occupied by a non-socket path: ${endpoint}`)
  }
  if (await canConnect(endpoint)) {
    throw new Error(`A Local Session Host is already listening at ${endpoint}`)
  }
  await unlink(endpoint)
}

export async function secureLocalSessionEndpoint(endpoint: string) {
  if (!isWindowsPipe(endpoint)) await chmod(endpoint, OWNER_SOCKET_MODE)
}

export async function removeLocalSessionEndpoint(endpoint: string) {
  if (!isWindowsPipe(endpoint) && (await endpointExists(endpoint))) await unlink(endpoint)
}
