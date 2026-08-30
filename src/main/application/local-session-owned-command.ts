import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { executeExplicitWaggleCancellation } from './explicit-waggle-command-cancellation'
import { executeExplicitWaggleCommand } from './explicit-waggle-command-service'
import {
  executeManualSessionCompaction,
  executeManualSessionCompactionCancellation,
} from './manual-session-compaction-service'

export function dispatchOwnerLocalSessionCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalSessionCommandPayload
  readonly signal?: AbortSignal
}) {
  const payload = input.payload
  if (payload.contract === 'session-waggle-v1') {
    return executeExplicitWaggleCommand({ caller: input.caller, payload })
  }
  if (payload.contract === 'session-waggle-cancel-v1') {
    return executeExplicitWaggleCancellation({ caller: input.caller, payload })
  }
  if (payload.contract === 'local-compaction-v1') {
    return executeManualSessionCompaction({
      caller: input.caller,
      payload,
      ...(input.signal ? { signal: input.signal } : {}),
    })
  }
  if (payload.contract === 'local-compaction-cancel-v1') {
    return executeManualSessionCompactionCancellation({ caller: input.caller, payload })
  }
  return undefined
}

export function isLocallyHandledCommand(payload: LocalSessionCommandPayload): payload is Extract<
  LocalSessionCommandPayload,
  {
    contract:
      | 'local-ui-v1'
      | 'local-attachments-v1'
      | 'local-compaction-v1'
      | 'local-compaction-cancel-v1'
      | 'session-waggle-v1'
      | 'session-waggle-cancel-v1'
  }
> {
  return (
    payload.contract === 'local-ui-v1' ||
    payload.contract === 'local-attachments-v1' ||
    payload.contract === 'local-compaction-v1' ||
    payload.contract === 'local-compaction-cancel-v1' ||
    payload.contract === 'session-waggle-v1' ||
    payload.contract === 'session-waggle-cancel-v1'
  )
}
