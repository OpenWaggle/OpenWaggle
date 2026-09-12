import type {
  TerminalInputIdentity,
  TerminalInputIntent,
  TerminalWriteResult,
} from '@shared/types/terminal'
import type {
  PendingTerminalInputPart,
  TerminalInputReceipt,
  TerminalProjectActionState,
} from './terminal-records'

export interface TerminalInputIdentityState {
  readonly inputIncarnation?: string
  inputGeneration: string | null
  lastInputReceipt: TerminalInputReceipt | null
}

export interface PendingTerminalInput extends TerminalInputIdentityState {
  parts: PendingTerminalInputPart[]
  bytes: number
  projectAction: TerminalProjectActionState | null
}

type IdentityDecision =
  | { readonly kind: 'accept' }
  | { readonly kind: 'result'; readonly result: TerminalWriteResult }

function rejected(
  identity: TerminalInputIdentity,
  reason: Extract<TerminalWriteResult, { status: 'rejected' }>['reason'],
): IdentityDecision {
  return {
    kind: 'result',
    result: { status: 'rejected', acceptedBytes: 0, reason, identity },
  }
}

/** Activate a renderer stream without discarding input already accepted by main. */
export function activateTerminalInputGeneration(
  state: TerminalInputIdentityState,
  generation: string | undefined,
) {
  if (generation === undefined || state.inputGeneration === generation) return
  state.inputGeneration = generation
  state.lastInputReceipt = null
}

/**
 * Validate one serial input request before touching the PTY. Only the latest
 * receipt is needed because a dispatcher has at most one request in flight.
 */
export function decideTerminalInputIdentity(
  state: TerminalInputIdentityState,
  data: string,
  identity: TerminalInputIdentity | undefined,
  intent?: TerminalInputIntent,
): IdentityDecision {
  if (identity === undefined) return { kind: 'accept' }
  if (identity.incarnation !== undefined && identity.incarnation !== state.inputIncarnation) {
    return rejected(identity, 'stale-generation')
  }
  if (state.inputGeneration === null) state.inputGeneration = identity.generation
  if (state.inputGeneration !== identity.generation) {
    return rejected(identity, 'stale-generation')
  }

  const receipt = state.lastInputReceipt
  if (receipt === null) {
    return identity.sequence === 0 ? { kind: 'accept' } : rejected(identity, 'sequence-gap')
  }
  if (identity.sequence === receipt.identity.sequence) {
    if (data !== receipt.data || !sameTerminalInputIntent(intent, receipt.intent)) {
      return rejected(identity, 'sequence-conflict')
    }
    return {
      kind: 'result',
      result: {
        // Echo the original delivery phase. A caller recovering from a lost
        // response must still know whether this accepted chunk is waiting
        // behind readiness, even though main does not write it twice.
        status: receipt.status,
        acceptedBytes: receipt.acceptedBytes,
        identity,
      },
    }
  }
  if (identity.sequence < receipt.identity.sequence) {
    return rejected(identity, 'stale-sequence')
  }
  if (identity.sequence !== receipt.identity.sequence + 1) {
    return rejected(identity, 'sequence-gap')
  }
  return { kind: 'accept' }
}

export function receiptForTerminalInput(
  identity: TerminalInputIdentity | undefined,
  data: string,
  result: TerminalWriteResult,
  intent?: TerminalInputIntent,
) {
  if (identity === undefined || result.status === 'rejected') {
    return null
  }
  return {
    identity,
    data,
    ...(intent === undefined ? {} : { intent }),
    acceptedBytes: result.acceptedBytes,
    status: result.status,
  } satisfies TerminalInputReceipt
}

function sameTerminalInputIntent(
  left: TerminalInputIntent | undefined,
  right: TerminalInputIntent | undefined,
) {
  if (left === undefined || right === undefined) return left === right
  return left.kind === right.kind && left.executionId === right.executionId
}

export function echoTerminalInputIdentity(
  result: TerminalWriteResult,
  identity: TerminalInputIdentity | undefined,
): TerminalWriteResult {
  return identity === undefined ? result : { ...result, identity }
}
