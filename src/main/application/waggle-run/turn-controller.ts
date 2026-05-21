import { DOUBLE_FACTOR } from '@shared/constants/math'
import { CONSENSUS } from '@shared/constants/text-processing'
import type { Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import type {
  WaggleCollaborationStatus,
  WaggleConfig,
  WaggleMessageMetadata,
  WaggleStreamMetadata,
  WaggleTurnEvent,
} from '@shared/types/waggle'
import { checkConsensus } from '../../agent/consensus-detector'
import type { FileConflictTracker } from '../../agent/file-conflict-tracker'
import { createLogger } from '../../logger'
import {
  extractFilePath,
  getUnresolvedToolCalls,
  summarizeUnresolvedTools,
  tagAssistantMessages,
  toWaggleMessageMetadata,
} from './metadata'

const logger = createLogger('waggle-run-service')

interface WaggleTurnControllerInput {
  readonly accumulatedMessages: Message[]
  readonly config: WaggleConfig
  readonly conflictTracker: FileConflictTracker
  readonly maxTurns: number
  readonly newTurnMetadata: WaggleMessageMetadata[]
  readonly onEvent: (event: AgentTransportEvent, meta: WaggleStreamMetadata) => void
  readonly onTurnEvent: (event: WaggleTurnEvent) => void
  readonly sessionId: SessionId
  readonly waggleSessionId: string
}

interface TurnCompleteInput {
  readonly meta: WaggleStreamMetadata
  readonly assistantMessages: readonly Message[]
  readonly responseText: string
  readonly hasToolCalls: boolean
  readonly terminalError?: string
}

class WaggleTurnController {
  private consecutiveErrorTurns = 0
  private consensusReason: string | undefined
  private lastAssistantTexts: [string, string] = ['', '']
  private lastTurnError: string | undefined
  private status: WaggleCollaborationStatus = 'running'
  private successfulTurnCount = 0

  constructor(private readonly input: WaggleTurnControllerInput) {}

  createTurnMetadata(turn: { readonly turnNumber: number; readonly agentIndex: number }) {
    const agent = this.input.config.agents[turn.agentIndex]
    return {
      agentIndex: turn.agentIndex,
      agentLabel: agent.label,
      agentColor: agent.color,
      agentModel: agent.model,
      turnNumber: turn.turnNumber,
      collaborationMode: this.input.config.mode,
      sessionId: this.input.waggleSessionId,
    }
  }

  handleWaggleEvent(event: AgentTransportEvent, meta: WaggleStreamMetadata) {
    this.input.onEvent(event, meta)
    if (event.type !== 'tool_execution_end') return
    if (event.toolName !== 'write' && event.toolName !== 'edit') return

    const filePath = extractFilePath(event.args)
    if (!filePath) return

    const warning = this.input.conflictTracker.recordModification(
      filePath,
      meta.agentIndex,
      this.input.config.agents,
      meta.turnNumber,
    )
    if (warning) this.input.onTurnEvent({ type: 'file-conflict', warning })
  }

  handleTurnComplete(turn: TurnCompleteInput) {
    if (turn.terminalError) return this.continueAfterRecoverableError(turn.terminalError, turn.meta)

    const taggedAssistantMessages = tagAssistantMessages(turn.assistantMessages, turn.meta)
    const unresolvedToolsStop = this.stopForUnresolvedTools(taggedAssistantMessages, turn.meta)
    if (unresolvedToolsStop) return unresolvedToolsStop

    if (turn.responseText.trim().length === 0 && !turn.hasToolCalls) {
      return this.continueAfterRecoverableError('Agent turn produced no useful output.', turn.meta)
    }

    this.recordSuccessfulTurn(taggedAssistantMessages, turn)
    return this.maybeStopForConsensus(turn.meta) ?? { continue: true }
  }

  completeIfStillRunning() {
    if (this.status !== 'running') return
    this.status = 'completed'
    this.input.onTurnEvent({
      type: 'collaboration-complete',
      reason: `Reached maximum turns (${String(this.successfulTurnCount)})`,
      totalTurns: this.successfulTurnCount,
    })
  }

  getState() {
    return {
      consensusReason: this.consensusReason,
      lastTurnError: this.lastTurnError,
      status: this.status,
      successfulTurnCount: this.successfulTurnCount,
    }
  }

  stopForUserCancel() {
    return this.stopCollaboration('User cancelled')
  }

  private stopCollaboration(reason: string) {
    this.status = 'stopped'
    this.input.onTurnEvent({ type: 'collaboration-stopped', reason })
    return { continue: false }
  }

  private continueAfterRecoverableError(error: string, meta: WaggleStreamMetadata) {
    this.consecutiveErrorTurns += 1
    this.lastTurnError = error
    logger.warn('Waggle turn failed', {
      sessionId: this.input.sessionId,
      turnNumber: meta.turnNumber,
      agentLabel: meta.agentLabel,
      consecutiveErrors: this.consecutiveErrorTurns,
      error,
    })

    return this.consecutiveErrorTurns >= DOUBLE_FACTOR
      ? this.stopCollaboration(error)
      : { continue: true }
  }

  private stopForUnresolvedTools(messages: readonly Message[], meta: WaggleStreamMetadata) {
    const unresolvedToolCalls = messages.flatMap((message) => getUnresolvedToolCalls(message))
    if (unresolvedToolCalls.length === 0) return null

    const tools = summarizeUnresolvedTools(unresolvedToolCalls)
    const reason = `Waggle stopped because ${meta.agentLabel} has unresolved tool calls (${tools}).`
    this.lastTurnError = reason
    this.status = 'stopped'
    this.input.onTurnEvent({ type: 'collaboration-stopped', reason })
    logger.warn('Stopping Waggle due unresolved tool calls', {
      sessionId: this.input.sessionId,
      turnNumber: meta.turnNumber,
      agentLabel: meta.agentLabel,
      unresolvedToolCalls,
    })
    return { continue: false }
  }

  private recordSuccessfulTurn(messages: readonly Message[], turn: TurnCompleteInput) {
    this.consecutiveErrorTurns = 0
    this.successfulTurnCount += 1
    this.input.accumulatedMessages.push(...messages)
    for (const _message of messages)
      this.input.newTurnMetadata.push(toWaggleMessageMetadata(turn.meta))
    this.input.onTurnEvent({
      type: 'turn-end',
      turnNumber: turn.meta.turnNumber,
      agentIndex: turn.meta.agentIndex,
      agentLabel: turn.meta.agentLabel,
      agentColor: turn.meta.agentColor,
      agentModel: turn.meta.agentModel,
    })
    this.lastAssistantTexts = [this.lastAssistantTexts[1], turn.responseText]
  }

  private maybeStopForConsensus(meta: WaggleStreamMetadata) {
    if (!this.canCheckConsensus()) return null

    const result = checkConsensus(this.lastAssistantTexts, meta.turnNumber + 1, this.input.maxTurns)
    if (!result.reached) return null

    this.input.onTurnEvent({ type: 'consensus-reached', result })
    return this.completeForConsensus(result.reason, meta)
  }

  private canCheckConsensus() {
    if (this.input.config.stop.primary !== 'consensus') return false
    if (
      this.input.accumulatedMessages.filter((message) => message.role === 'assistant').length <
      DOUBLE_FACTOR
    )
      return false
    if (this.lastAssistantTexts[0].trim().length <= CONSENSUS.MIN_SUBSTANTIVE_LENGTH) return false
    return this.lastAssistantTexts[1].trim().length > CONSENSUS.MIN_SUBSTANTIVE_LENGTH
  }

  private completeForConsensus(reason: string, meta: WaggleStreamMetadata) {
    this.status = 'completed'
    this.consensusReason = reason
    this.input.onTurnEvent({
      type: 'collaboration-complete',
      reason: `Consensus reached: ${reason}`,
      totalTurns: this.successfulTurnCount,
    })
    logger.info('Waggle consensus reached', {
      sessionId: this.input.sessionId,
      totalTurns: this.successfulTurnCount,
      reason,
      turnNumber: meta.turnNumber,
    })
    return { continue: false }
  }
}

export function createWaggleTurnController(input: WaggleTurnControllerInput) {
  const controller = new WaggleTurnController(input)

  return {
    completeIfStillRunning: () => controller.completeIfStillRunning(),
    createTurnMetadata: (turn: { readonly turnNumber: number; readonly agentIndex: number }) =>
      controller.createTurnMetadata(turn),
    getState: () => controller.getState(),
    handleTurnComplete: (turn: TurnCompleteInput) => controller.handleTurnComplete(turn),
    handleWaggleEvent: (event: AgentTransportEvent, meta: WaggleStreamMetadata) =>
      controller.handleWaggleEvent(event, meta),
    stopForUserCancel: () => controller.stopForUserCancel(),
  }
}
