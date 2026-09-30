export const LOCAL_HOST_CONTRACT_VERSION = 1 as const

/** Ask the Session Host to stop: it accepts no new work and exits once its active work ends. */
export interface LocalHostStopRequest {
  readonly contractVersion: typeof LOCAL_HOST_CONTRACT_VERSION
  readonly operation: 'stop'
}

export type LocalHostRequest = LocalHostStopRequest

export interface LocalHostStopResponse {
  readonly contractVersion: typeof LOCAL_HOST_CONTRACT_VERSION
  readonly operation: 'stop'
  readonly hostInstanceId: string
  /** Runs the Host waits for before it exits; `null` when it could not count them. */
  readonly blockingRuns: number | null
  /** Running Actions, such as dev servers, the Host also waits for. */
  readonly blockingActions: number
}

export type LocalHostResponse = LocalHostStopResponse

export interface LocalHostCommandPayload {
  readonly contract: 'local-host-v1'
  readonly request: LocalHostRequest
}

export interface LocalHostCommandResult {
  readonly contract: 'local-host-v1'
  readonly response: LocalHostResponse
}
