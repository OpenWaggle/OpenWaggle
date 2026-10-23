import type { Socket } from 'node:net'
import type { LocalSessionProfileManagementResponse } from '@shared/types/local-session-profile-management'
import * as Cause from 'effect/Cause'
import * as Option from 'effect/Option'
import * as Runtime from 'effect/Runtime'
import { createLogger } from '../logger'
import { encodeLocalSessionFrameSegments } from './local-session-framing'
import {
  type LocalSessionOutboundByteBudget,
  LocalSessionOutboundCapacityError,
  type LocalSessionOutboundOwner,
} from './local-session-outbound-budget'

const logger = createLogger('session-host/outbound')

/** The message Effect gives a tagged error that was created without one. */
const EFFECT_DEFAULT_ERROR_MESSAGE = 'An error has occurred'

function stringField(value: object, key: string) {
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

const MAX_DESCRIBED_CAUSES = 3
const MAX_DETAIL_LENGTH = 500
/**
 * Fields of a structured cause that identify what failed. Only these are shown, so a cause
 * that carries credentials, settings, or payloads never reaches a client.
 */
const DESCRIBED_DETAIL_FIELDS = ['reason', 'projectPath', 'sessionId', 'workspaceId', 'runId']

function describeDetails(value: object) {
  const details = DESCRIBED_DETAIL_FIELDS.flatMap((key) => {
    const field = stringField(value, key)
    return field ? [`${key}=${field}`] : []
  }).join(', ')
  if (!details) return undefined
  return details.length > MAX_DETAIL_LENGTH ? `${details.slice(0, MAX_DETAIL_LENGTH)}…` : details
}

function describeFailure(failure: unknown, depth = 0): string | undefined {
  if (typeof failure !== 'object' || failure === null) {
    return failure === undefined ? undefined : String(failure)
  }
  const message = stringField(failure, 'message')
  if (message && message !== EFFECT_DEFAULT_ERROR_MESSAGE) return message
  // A tagged error without a message still says what failed through its tag, code,
  // operation, and underlying cause.
  const tag = stringField(failure, '_tag')
  const code = stringField(failure, 'code')
  const label = [tag, code].filter(Boolean).join(': ')
  const operation = stringField(failure, 'operation')
  if (!tag && !code && !operation) return describeDetails(failure)
  const cause: unknown = Reflect.get(failure, 'cause')
  const reason = depth < MAX_DESCRIBED_CAUSES ? describeFailure(cause, depth + 1) : undefined
  const described = [
    label ? `${label}${operation ? ` (${operation})` : ''}` : operation,
    reason,
  ].filter(Boolean)
  return described.length > 0 ? described.join(': ') : undefined
}

/** Shown when a failure names nothing safe to show; its details stay in the Host. */
const UNDESCRIBED_FAILURE = 'The Session Host could not complete the request.'

/**
 * The peer of the Local Session socket went away while a frame was written, so the write failed
 * with a disconnect verdict such as EPIPE. This is how a client exits, not an anomaly: callers
 * treat it as the end of the connection instead of reporting it.
 */
export class LocalSessionClientDisconnectedError extends Error {
  constructor() {
    super('The Local Session client disconnected before its frame was written.')
  }
}

/** Write failures that mean the peer is gone, rather than that something went wrong. */
const CLIENT_DISCONNECT_ERROR_CODES = new Set([
  'EPIPE',
  'ECONNRESET',
  'ESHUTDOWN',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_WRITE_AFTER_END',
  'ERR_STREAM_ALREADY_FINISHED',
  'ERR_SOCKET_CLOSED',
])

function isClientDisconnect(error: unknown, socket: Socket) {
  const code: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
  return (
    (typeof code === 'string' && CLIENT_DISCONNECT_ERROR_CODES.has(code)) ||
    socket.destroyed ||
    !socket.writable
  )
}

export function describeLocalSessionServerError(error: unknown) {
  const described = describeServerError(error)
  return described.trim() === '' ? UNDESCRIBED_FAILURE : described
}

function describeServerError(error: unknown) {
  if (!Runtime.isFiberFailure(error)) {
    return describeFailure(error) ?? (error instanceof Error ? error.message : UNDESCRIBED_FAILURE)
  }
  // A FiberFailure prints its whole cause, including any object it carries, so only the
  // failure or defect inside it is described.
  const cause = error[Runtime.FiberFailureCauseId]
  const failure =
    Option.getOrUndefined(Cause.failureOption(cause)) ??
    Option.getOrUndefined(Cause.dieOption(cause))
  return describeFailure(failure) ?? UNDESCRIBED_FAILURE
}

function writeSocketSegment(socket: Socket, segment: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(segment, (error) => {
      if (!error) {
        resolve()
        return
      }
      if (isClientDisconnect(error, socket)) reject(new LocalSessionClientDisconnectedError())
      else reject(error)
    })
  })
}

/** A capacity wait longer than this is logged, so slow readers show up before any eviction. */
const LOGGED_CAPACITY_WAIT_MS = 1_000

function budgetUsage(budget: LocalSessionOutboundByteBudget) {
  return {
    pendingBytes: budget.pendingBytes,
    peakBytes: budget.peakBytes,
    maxBytes: budget.maxBytes,
  }
}

const outboundOwners = new WeakMap<Socket, LocalSessionOutboundOwner>()

/** One owner per socket, so the budget closes a connection once however many frames it holds. */
function outboundOwner(input: FrameWriteInput) {
  const known = outboundOwners.get(input.socket)
  if (known) return known
  const { socket, budget, peer } = input
  const owner: LocalSessionOutboundOwner = {
    evict: (unreadForMs) => {
      logger.warn('Closing a Local Session connection that stopped reading its frames.', {
        peer: peer?.(),
        unreadForMs: Math.round(unreadForMs),
        ...budgetUsage(budget),
      })
      socket.destroy()
    },
  }
  outboundOwners.set(socket, owner)
  return owner
}

interface FrameWriteInput {
  readonly socket: Socket
  readonly value: unknown
  readonly budget: LocalSessionOutboundByteBudget
  readonly signal: AbortSignal
  /** Names the connection's caller in logs, such as `gui:local-user`. */
  readonly peer?: (() => string | undefined) | undefined
}

export async function writeLocalSessionSocketFrame(input: FrameWriteInput): Promise<void> {
  const lease = await input.budget
    .encode(input.value, input.signal, outboundOwner(input))
    .catch((error: unknown) => {
      if (error instanceof LocalSessionOutboundCapacityError) {
        // No connection that held an unread frame since this one arrived was left to close.
        logger.warn('Closing a Local Session connection: the outbound byte budget stayed full.', {
          peer: input.peer?.(),
          ...budgetUsage(input.budget),
        })
        input.socket.destroy()
      }
      throw error
    })
  if (lease.waitedMs > LOGGED_CAPACITY_WAIT_MS) {
    logger.info('A Local Session frame waited for outbound capacity.', {
      peer: input.peer?.(),
      waitedMs: Math.round(lease.waitedMs),
      ...budgetUsage(input.budget),
    })
  }
  const release = lease.release
  input.socket.once('close', release)
  try {
    if (input.signal.aborted || input.socket.destroyed || !input.socket.writable) {
      throw new Error('Local Session client disconnected before its response was written.')
    }
    for (const segment of encodeLocalSessionFrameSegments(lease.payload)) {
      // The guard above ran before the first segment; a large frame spans several writes, and
      // the peer can go away in between, where the next write would only fail with EPIPE.
      if (input.signal.aborted || input.socket.destroyed || !input.socket.writable) {
        throw new LocalSessionClientDisconnectedError()
      }
      await writeSocketSegment(input.socket, segment)
    }
  } finally {
    input.socket.off('close', release)
    release()
  }
}

interface LocalAccessPayload {
  readonly contract: 'local-access-v1'
  readonly response: LocalSessionProfileManagementResponse
}

function isLocalAccessPayload(value: unknown): value is LocalAccessPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'contract' in value &&
    value.contract === 'local-access-v1' &&
    'response' in value
  )
}

export function invalidatedProfileId(value: unknown): string | undefined {
  if (!isLocalAccessPayload(value)) return
  const outcome = value.response.outcome
  return outcome.effect === 'profile-revoked' || outcome.effect === 'profile-rotated'
    ? outcome.profile.id
    : undefined
}

export function refreshedProfileId(value: unknown): string | undefined {
  if (!isLocalAccessPayload(value)) return
  const outcome = value.response.outcome
  return outcome.effect === 'profile-updated' ? outcome.profile.id : undefined
}
