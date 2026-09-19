import { readFile } from 'node:fs/promises'
import net, { type Socket } from 'node:net'
import { decodeLocalSessionNegotiationResult } from '@shared/schemas/local-session-protocol'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import {
  LOCAL_SESSION_PROTOCOL_NAME,
  LOCAL_SESSION_SUPPORTED_REVISIONS,
} from '@shared/types/local-session-protocol'
import {
  LocalSessionClientProtocolError,
  localSessionClientProtocolError,
} from './local-session-client-protocol-error'
import { isWindowsPipe } from './local-session-endpoint'
import { encodeLocalSessionFrame, LocalSessionFrameDecoder } from './local-session-framing'
import type { LocalSessionHostPaths } from './local-session-paths'
import {
  createLocalSessionServerAuthenticationRequest,
  verifyLocalSessionServerAuthenticationResponse,
} from './local-session-server-authentication'

export const LOCAL_SESSION_DEFAULT_CLIENT_TIMEOUT_MS = 10_000

export class LocalSessionHostUpgradePendingError extends Error {
  readonly code = 'host_upgrade_pending'

  constructor(
    readonly hostInstanceId: string,
    readonly blockingRuns: readonly { readonly sessionId: string; readonly runId: string }[],
    readonly blockingOperations: readonly {
      readonly operationId: string
      readonly operation: string
      readonly targetScope: string
    }[],
  ) {
    const blockerCount = blockingRuns.length + blockingOperations.length
    super(
      blockerCount === 0
        ? 'The existing Local Session Host is releasing ownership for a safe version handoff.'
        : `The existing Local Session Host is draining ${blockerCount} active ${blockerCount === 1 ? 'operation' : 'operations'} before a safe version handoff.`,
    )
    this.name = 'LocalSessionHostUpgradePendingError'
  }
}

export class LocalSessionHostConnectionClosedError extends Error {
  readonly code = 'ECONNRESET'

  constructor() {
    super('Local Session Host connection closed.')
    this.name = 'LocalSessionHostConnectionClosedError'
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class LocalSessionFrameReader {
  private readonly decoder = new LocalSessionFrameDecoder()
  private readonly pending: unknown[] = []
  private waiter: ((value: unknown) => void) | null = null
  private failure: Error | null = null

  constructor(private readonly socket: Socket) {
    socket.pause()
    socket.on('data', (chunk) => {
      try {
        for (const value of this.decoder.push(chunk)) this.push(value)
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.once('error', (error) => this.fail(error))
    socket.once('close', () => this.fail(new LocalSessionHostConnectionClosedError()))
  }

  private push(value: unknown) {
    if (!this.waiter) {
      this.pending.push(value)
      return
    }
    const waiter = this.waiter
    this.waiter = null
    this.socket.pause()
    waiter(value)
  }

  private fail(error: Error) {
    if (this.failure) return
    this.failure = error
    this.socket.pause()
    if (!this.waiter) return
    const waiter = this.waiter
    this.waiter = null
    waiter({ kind: '__client-error', error })
  }

  async next(timeoutMs?: number): Promise<unknown> {
    if (this.pending.length > 0) return this.pending.shift()
    if (this.failure) throw this.failure
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              this.waiter = null
              this.socket.pause()
              reject(new Error('Timed out waiting for the Local Session Host.'))
            }, timeoutMs)
      this.waiter = (value) => {
        if (timer) clearTimeout(timer)
        if (isRecord(value) && value.kind === '__client-error' && value.error instanceof Error) {
          reject(value.error)
          return
        }
        resolve(value)
      }
      this.socket.resume()
    })
  }

  bufferedFrameCount() {
    return this.pending.length
  }
}

export interface LocalSessionClientConnectionInput {
  readonly paths: LocalSessionHostPaths
  readonly clientKind?: 'gui' | 'cli' | 'mcp' | 'internal'
  readonly clientVersion: string
  readonly workingDirectory?: string
  readonly profile?: string
  readonly transientAuthority?: LocalSessionProfileAuthority
  readonly profileCredential?: string
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  /** Test and forward-compatibility hook; ordinary clients advertise current and previous. */
  readonly supportedRevisions?: readonly number[]
}

export interface ResolvedLocalSessionClientAuthentication {
  readonly credential: string
  readonly serverAuthentication?: {
    readonly credential: string
    readonly profile?: string
  }
}

export async function resolveLocalSessionClientAuthentication(
  input: Pick<LocalSessionClientConnectionInput, 'paths' | 'profile' | 'profileCredential'>,
  readLocalUserCredential: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): Promise<ResolvedLocalSessionClientAuthentication> {
  if (input.profile !== undefined) {
    if (input.profile.length === 0) throw new Error('A Local Session profile name is required.')
    if (!input.profileCredential) throw new Error('A Local Session credential is required.')
    return {
      credential: input.profileCredential,
      ...(isWindowsPipe(input.paths.endpoint)
        ? {
            serverAuthentication: {
              credential: input.profileCredential,
              profile: input.profile,
            },
          }
        : {}),
    }
  }
  const credential = (await readLocalUserCredential(input.paths.credentialPath)).trim()
  if (!credential) throw new Error('A Local Session credential is required.')
  return {
    credential,
    ...(isWindowsPipe(input.paths.endpoint) ? { serverAuthentication: { credential } } : {}),
  }
}

export async function authenticateLocalSessionServer(input: {
  readonly socket: Socket
  readonly reader: LocalSessionFrameReader
  readonly credential: string
  readonly profile?: string
  readonly timeoutMs: number
}) {
  const request = createLocalSessionServerAuthenticationRequest(input.profile)
  await writeLocalSessionFrame(input.socket, request)
  const value = await input.reader.next(input.timeoutMs)
  try {
    await verifyLocalSessionServerAuthenticationResponse({
      value,
      request,
      credential: input.credential,
    })
  } catch (cause) {
    throw new LocalSessionClientProtocolError(
      'authentication_failed',
      cause instanceof Error ? cause.message : 'Local Session authentication failed.',
      { cause },
    )
  }
}

export async function openLocalSessionConnection(input: LocalSessionClientConnectionInput) {
  throwIfAborted(input.signal)
  const timeoutMs = input.timeoutMs ?? LOCAL_SESSION_DEFAULT_CLIENT_TIMEOUT_MS
  const authentication = await resolveLocalSessionClientAuthentication(input)
  throwIfAborted(input.signal)
  const socket = await connect(input.paths.endpoint, timeoutMs, input.signal)
  const reader = new LocalSessionFrameReader(socket)
  const detachAbort = attachConnectionAbortSignal(socket, input.signal)
  try {
    if (authentication.serverAuthentication) {
      await authenticateLocalSessionServer({
        socket,
        reader,
        credential: authentication.serverAuthentication.credential,
        ...(authentication.serverAuthentication.profile !== undefined
          ? { profile: authentication.serverAuthentication.profile }
          : {}),
        timeoutMs,
      })
    }
    await writeLocalSessionFrame(socket, {
      protocol: LOCAL_SESSION_PROTOCOL_NAME,
      supportedRevisions: input.supportedRevisions ?? [...LOCAL_SESSION_SUPPORTED_REVISIONS],
      clientKind: input.clientKind ?? 'cli',
      clientVersion: input.clientVersion,
      ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.transientAuthority ? { transientAuthority: input.transientAuthority } : {}),
      credential: authentication.credential,
    })
    const negotiationFrame = await reader.next(timeoutMs)
    if (isRecord(negotiationFrame) && negotiationFrame.kind === 'error') {
      throw localSessionClientProtocolError(
        negotiationFrame,
        'Local Session authentication failed.',
      )
    }
    const negotiation = decodeLocalSessionNegotiationResult(negotiationFrame)
    if (!negotiation.accepted) {
      if (negotiation.code === 'host_upgrade_pending') {
        throw new LocalSessionHostUpgradePendingError(
          negotiation.hostInstanceId,
          negotiation.blockingRuns,
          negotiation.blockingOperations,
        )
      }
      throw new Error('The Local Session Host has no compatible transport revision.')
    }
    return { socket, reader, negotiation, timeoutMs }
  } catch (error) {
    socket.destroy()
    throw error
  } finally {
    detachAbort()
  }
}

function throwIfAborted(signal?: AbortSignal) {
  signal?.throwIfAborted()
}

function attachConnectionAbortSignal(socket: Socket, signal?: AbortSignal) {
  if (!signal) return () => undefined
  if (signal.aborted) {
    socket.destroy()
    signal.throwIfAborted()
  }
  const abort = () => socket.destroy(abortError(signal))
  signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}

function abortError(signal?: AbortSignal) {
  if (signal?.reason instanceof Error) return signal.reason
  const error = new Error('Local Session Host connection aborted.')
  error.name = 'AbortError'
  return error
}

function connect(endpoint: string, timeoutMs: number, signal?: AbortSignal) {
  return new Promise<Socket>((resolve, reject) => {
    signal?.throwIfAborted()
    const socket = net.createConnection(endpoint)
    const abort = () => {
      const error = abortError(signal)
      clearTimeout(timer)
      socket.destroy()
      reject(error)
    }
    const settle = () => signal?.removeEventListener('abort', abort)
    const timer = setTimeout(() => {
      settle()
      socket.destroy()
      reject(new Error('Timed out connecting to the Local Session Host.'))
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      settle()
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      settle()
      reject(error)
    })
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function writeLocalSessionFrame(socket: Socket, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    socket.write(encodeLocalSessionFrame(value), (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
