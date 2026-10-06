export const LOCAL_HOST_CONTRACT_VERSION = 1 as const

/** Ask the Session Host to stop: it accepts no new work and exits once its active work ends. */
export interface LocalHostStopRequest {
  readonly contractVersion: typeof LOCAL_HOST_CONTRACT_VERSION
  readonly operation: 'stop'
  /**
   * `update`: the stop that installing an update sends, from the desktop app, `openwaggle update`
   * or the install script (ADR 0047). It has a deadline and answers with the Host's process id.
   */
  readonly purpose?: 'update'
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
  /**
   * The Host's process id, sent only for an update stop, so the installer can wait for that
   * process to exit (ADR 0047).
   */
  readonly processId?: number
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
