import type { Socket } from 'node:net'
import type { LocalSessionProfileManagementResponse } from '@shared/types/local-session-profile-management'
import { encodeLocalSessionFrameSegments } from './local-session-framing'
import {
  type LocalSessionOutboundByteBudget,
  LocalSessionOutboundCapacityError,
} from './local-session-outbound-budget'

export function describeLocalSessionServerError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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
