import { readFile } from 'node:fs/promises'
import net, { type Socket } from 'node:net'
import { decodeLocalSessionNegotiationResult } from '@shared/schemas/local-session-protocol'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import {
  LOCAL_SESSION_PROTOCOL_NAME,
  LOCAL_SESSION_SUPPORTED_REVISIONS,
} from '@shared/types/local-session-protocol'
import { encodeLocalSessionFrame, LocalSessionFrameDecoder } from './local-session-framing'
import type { LocalSessionHostPaths } from './local-session-paths'

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class LocalSessionFrameReader {
  private readonly decoder = new LocalSessionFrameDecoder()
  private readonly pending: unknown[] = []
  private waiter: ((value: unknown) => void) | null = null
  private failure: Error | null = null

  constructor(socket: Socket) {
    socket.on('data', (chunk) => {
      try {
        for (const value of this.decoder.push(chunk)) this.push(value)
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.once('error', (error) => this.fail(error))
    socket.once('close', () => this.fail(new Error('Local Session Host connection closed.')))
  }

  private push(value: unknown) {
    if (!this.waiter) {
      this.pending.push(value)
      return
    }
    const waiter = this.waiter
    this.waiter = null
    waiter(value)
  }

  private fail(error: Error) {
    if (this.failure) return
    this.failure = error
    if (!this.waiter) return
    const waiter = this.waiter
    this.waiter = null
    waiter({ kind: '__client-error', error })
  }

  async next(timeoutMs?: number): Promise<unknown> {
    const queued = this.pending.shift()
    if (queued !== undefined) return queued
    if (this.failure) throw this.failure
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              this.waiter = null
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
    })
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
  /** Test and forward-compatibility hook; ordinary clients advertise current and previous. */
  readonly supportedRevisions?: readonly number[]
}

export async function openLocalSessionConnection(input: LocalSessionClientConnectionInput) {
  const timeoutMs = input.timeoutMs ?? LOCAL_SESSION_DEFAULT_CLIENT_TIMEOUT_MS
  const credential = input.profile
    ? input.profileCredential
    : (await readFile(input.paths.credentialPath, 'utf8')).trim()
  if (!credential) throw new Error('A Local Session credential is required.')
  const socket = await connect(input.paths.endpoint, timeoutMs)
  const reader = new LocalSessionFrameReader(socket)
  try {
    await writeLocalSessionFrame(socket, {
      protocol: LOCAL_SESSION_PROTOCOL_NAME,
      supportedRevisions: input.supportedRevisions ?? [...LOCAL_SESSION_SUPPORTED_REVISIONS],
      clientKind: input.clientKind ?? 'cli',
      clientVersion: input.clientVersion,
      ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.transientAuthority ? { transientAuthority: input.transientAuthority } : {}),
      credential,
    })
    const negotiationFrame = await reader.next(timeoutMs)
    if (isRecord(negotiationFrame) && negotiationFrame.kind === 'error') {
      throw new Error(
        typeof negotiationFrame.message === 'string'
          ? negotiationFrame.message
          : 'Local Session authentication failed.',
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
  }
}

function connect(endpoint: string, timeoutMs: number) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = net.createConnection(endpoint)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Timed out connecting to the Local Session Host.'))
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
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
