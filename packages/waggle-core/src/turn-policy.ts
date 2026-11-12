import type { WaggleAgentSlot, WaggleConfig } from './config.js'

const FIRST_AGENT_INDEX = 0
const SECOND_AGENT_INDEX = 1
const WAGGLE_AGENT_COUNT = 2
const NEXT_TURN_INCREMENT = 1

export interface WaggleTurn {
  readonly turnNumber: number
  readonly agentIndex: number
  readonly agent: WaggleAgentSlot
}

export type WaggleStopReason = 'turn-limit' | 'consensus' | 'user-stop' | 'terminal-error'

export interface WaggleTurnCompletion {
  readonly turnNumber: number
  readonly consensusReached?: boolean
  readonly terminalError?: string
}

export interface WaggleTurnDecision {
  readonly continue: boolean
  readonly reason?: WaggleStopReason
  readonly nextTurn?: WaggleTurn
}

export function getWaggleTurnAgentIndex(turnNumber: number) {
  const result: 0 | 1 =
    turnNumber % WAGGLE_AGENT_COUNT === FIRST_AGENT_INDEX ? FIRST_AGENT_INDEX : SECOND_AGENT_INDEX
  return result
}

export function getWaggleTurn(config: WaggleConfig, turnNumber: number) {
  const agentIndex = getWaggleTurnAgentIndex(turnNumber)
  const agent = config.agents[agentIndex]
  const turn: WaggleTurn = { turnNumber, agentIndex, agent }
  return turn
}

function completedTurnCount(turnNumber: number) {
  return turnNumber + NEXT_TURN_INCREMENT
}

export function decideNextWaggleTurn(config: WaggleConfig, completion: WaggleTurnCompletion) {
  if (completion.terminalError) {
    const decision: WaggleTurnDecision = { continue: false, reason: 'terminal-error' }
    return decision
  }

  if (completion.consensusReached) {
    const decision: WaggleTurnDecision = { continue: false, reason: 'consensus' }
    return decision
  }

  if (completedTurnCount(completion.turnNumber) >= config.stop.maxTurnsSafety) {
    const decision: WaggleTurnDecision = { continue: false, reason: 'turn-limit' }
    return decision
  }

  const decision: WaggleTurnDecision = {
    continue: true,
    nextTurn: getWaggleTurn(config, completion.turnNumber + NEXT_TURN_INCREMENT),
  }
  return decision
}
