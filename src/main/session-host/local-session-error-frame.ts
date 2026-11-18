import {
  type SessionHostRefusalCode,
  sessionHostRefusal,
} from '@shared/domain/session-host-refusals'

export type { SessionHostRefusalCode }

/** The `code` and `errorKind` of an error frame (`kind` names the frame type there). */
export function localSessionErrorFrameCode(code: SessionHostRefusalCode) {
  const refusal = sessionHostRefusal(code)
  return { code: refusal.code, errorKind: refusal.kind }
}

/** A connection-level error frame, which names the kind of its code (ADR 0063). */
export function localSessionErrorFrame(
  code: SessionHostRefusalCode,
  message: string,
  retryable: boolean,
) {
  return { kind: 'error', ...localSessionErrorFrameCode(code), message, retryable } as const
}
