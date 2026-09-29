import type { Socket } from 'node:net'
import type { LocalSessionProfileManagementResponse } from '@shared/types/local-session-profile-management'
import * as Cause from 'effect/Cause'
import * as Option from 'effect/Option'
import * as Runtime from 'effect/Runtime'
import { encodeLocalSessionFrameSegments } from './local-session-framing'
import {
  type LocalSessionOutboundByteBudget,
  LocalSessionOutboundCapacityError,
} from './local-session-outbound-budget'

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
  const label = [tag, stringField(failure, 'code')].filter(Boolean).join(': ')
  const operation = stringField(failure, 'operation')
  if (!tag && !operation && !message) return describeDetails(failure)
  const cause: unknown = Reflect.get(failure, 'cause')
  const reason = depth < MAX_DESCRIBED_CAUSES ? describeFailure(cause, depth + 1) : undefined
  const described = [
    label ? `${label}${operation ? ` (${operation})` : ''}` : operation,
    reason,
  ].filter(Boolean)
  return described.length > 0 ? described.join(': ') : message
}

export function describeLocalSessionServerError(error: unknown) {
  const failure = Runtime.isFiberFailure(error)
    ? Option.getOrUndefined(Cause.failureOption(error[Runtime.FiberFailureCauseId]))
    : error
  return describeFailure(failure ?? error) ?? String(error)
}

function writeSocketSegment(socket: Socket, segment: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(segment, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export async function writeLocalSessionSocketFrame(input: {
  readonly socket: Socket
  readonly value: unknown
  readonly budget: LocalSessionOutboundByteBudget
  readonly signal: AbortSignal
}): Promise<void> {
  const lease = await input.budget.encode(input.value, input.signal).catch((error: unknown) => {
    if (error instanceof LocalSessionOutboundCapacityError) input.socket.destroy()
    throw error
  })
  const release = lease.release
  input.socket.once('close', release)
  try {
    if (input.signal.aborted || input.socket.destroyed || !input.socket.writable) {
      throw new Error('Local Session client disconnected before its response was written.')
    }
    for (const segment of encodeLocalSessionFrameSegments(lease.payload)) {
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
