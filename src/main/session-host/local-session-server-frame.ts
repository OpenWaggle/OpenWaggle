import type { Socket } from 'node:net'
import type { LocalSessionProfileManagementResponse } from '@shared/types/local-session-profile-management'
import { encodeLocalSessionFrame } from './local-session-framing'

export function describeLocalSessionServerError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function writeLocalSessionSocketFrame(socket: Socket, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(encodeLocalSessionFrame(value), (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
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
