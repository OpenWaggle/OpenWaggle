import type {
  SESSION_CONTROL_CONTRACT_VERSION,
  SessionControlMutationOutcome,
} from './session-control'

export interface SessionControlMutationResponse {
  readonly contractVersion: typeof SESSION_CONTROL_CONTRACT_VERSION
  readonly requestId: string
  readonly idempotencyKey: string
  readonly replayed: boolean
  readonly outcome: SessionControlMutationOutcome
}
