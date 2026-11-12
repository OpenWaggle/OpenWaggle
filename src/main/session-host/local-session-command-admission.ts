import { decodeLocalSessionCommandPayloadForRevision } from '@shared/schemas/local-session-protocol'
import type { LocalSessionClientFrame } from '@shared/types/local-session-client-frame'
import type { AuthenticatedLocalSessionCaller } from './local-session-server'

export interface ActiveLocalSessionCommand {
  readonly controller: AbortController
  abortOnProfileFence: boolean
}

export class LocalSessionProfileAdmissionChangedError extends Error {
  readonly code = 'profile_admission_changed'
  readonly retryable = true

  constructor() {
    super('Local Session profile authority changed while the command was active.')
  }
}

/** Aborts the active commands that a profile admission fence must not let finish. */
export function abortProfileFencedCommands(commands: Iterable<ActiveLocalSessionCommand>) {
  for (const command of commands) {
    if (command.abortOnProfileFence) {
      command.controller.abort(new LocalSessionProfileAdmissionChangedError())
    }
  }
}

export function isSelfProfileCredentialMutation(input: {
  readonly caller: AuthenticatedLocalSessionCaller
  readonly frame: Extract<LocalSessionClientFrame, { kind: 'command' }>
  readonly negotiatedRevision: number
}) {
  const profileName = input.caller.profileAuthority?.profileName
  if (!profileName) return false
  try {
    const payload = decodeLocalSessionCommandPayloadForRevision(
      input.frame.payload,
      input.negotiatedRevision,
    )
    if (payload.contract !== 'local-access-v1') return false
    const command = payload.request.command
    return (
      (command.operation === 'rotate' || command.operation === 'revoke') &&
      command.profileName === profileName
    )
  } catch {
    return false
  }
}
