export interface SessionControlInterruptCommand {
  readonly operation: 'interrupt'
  readonly sessionId: string
  readonly expectedRunId: string
}

export interface SessionControlInterruptDescendantsCommand {
  readonly operation: 'interrupt-descendants'
  readonly sessionId: string
}

export interface SessionControlDescendantInterruptionOutcome {
  readonly operation: 'interrupt-descendants'
  readonly effect: 'descendant-interruptions-requested'
  readonly sessionId: string
  readonly interrupted: readonly {
    readonly sessionId: string
    readonly runId: string
    readonly stateRevision: number
  }[]
  readonly stateRevision: number
}
