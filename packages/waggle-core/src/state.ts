import type { WaggleConfig } from './config'
import type { WaggleTurnMetadata } from './events'
import { metadataForWaggleTurn } from './events'
import {
  decideNextWaggleTurn,
  getWaggleTurn,
  type WaggleStopReason,
  type WaggleTurnCompletion,
} from './turn-policy'

const INITIAL_TURN_NUMBER = 0

export type WaggleRunStatus = 'running' | 'complete'

export interface WaggleRunState {
  readonly config: WaggleConfig
  readonly sessionId?: string
  readonly status: WaggleRunStatus
  readonly currentTurn: WaggleTurnMetadata | null
  readonly completedTurns: readonly WaggleTurnMetadata[]
  readonly stopReason?: WaggleStopReason
}

function turnMetadata(input: Pick<WaggleRunState, 'config' | 'sessionId'>, turnNumber: number) {
  return metadataForWaggleTurn({
    turn: getWaggleTurn(input.config, turnNumber),
    collaborationMode: input.config.mode,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  })
}

export function startWaggleRun(input: {
  readonly config: WaggleConfig
  readonly sessionId?: string
}): WaggleRunState {
  return {
    config: input.config,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    status: 'running',
    currentTurn: turnMetadata(input, INITIAL_TURN_NUMBER),
    completedTurns: [],
  }
}

export function completeWaggleTurn(
  state: WaggleRunState,
  completion: WaggleTurnCompletion,
): WaggleRunState {
  const completedTurn = state.currentTurn
  const completedTurns = completedTurn
    ? [...state.completedTurns, completedTurn]
    : state.completedTurns
  const decision = decideNextWaggleTurn(state.config, completion)

  if (!decision.continue || !decision.nextTurn) {
    return {
      ...state,
      status: 'complete',
      currentTurn: null,
      completedTurns,
      stopReason: decision.reason,
    }
  }

  return {
    ...state,
    currentTurn: metadataForWaggleTurn({
      turn: decision.nextTurn,
      collaborationMode: state.config.mode,
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    }),
    completedTurns,
  }
}
