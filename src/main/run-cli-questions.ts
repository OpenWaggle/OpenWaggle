import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import type { LocalSessionCliClientInput } from './local-session-cli-client'
import {
  describeInteraction,
  isAffirmativeAnswer,
  isAuthorizationConfirmation,
  PromptInterruptedError,
  respondCommandHint,
  sessionControlPayload,
} from './run-cli-interactions'
import type { RunCliOutput } from './run-cli-output'
import type { RunCliPresenter } from './run-cli-presenter'
import { sessionCliResultErrorKind } from './session-cli-exit-status'

/** Why a question on screen was withdrawn. */
const ANSWERED_ELSEWHERE = 'answered-elsewhere'
const RUN_ENDED = 'run-ended'

export interface RunCliQuestionsInput {
  readonly clientInput: LocalSessionCliClientInput
  readonly execute: (
    input: LocalSessionCliClientInput & { readonly payload: LocalSessionCommandPayload },
  ) => Promise<LocalSessionCommandResult>
  readonly ask: (question: string, signal: AbortSignal) => Promise<string>
  readonly interactive: boolean
  readonly output: RunCliOutput
  readonly presenter: RunCliPresenter
  readonly status: (text: string) => void
  readonly onPromptInterrupted: () => void
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Shows the agent's questions one at a time and sends the terminal's answers to the Host. */
export class RunCliQuestions {
  private readonly open = new Map<string, AbortController>()
  private queue = Promise.resolve()

  constructor(private readonly input: RunCliQuestionsInput) {}

  enqueue(interaction: AgentLoopInteraction) {
    const controller = new AbortController()
    this.open.set(interaction.interactionId, controller)
    this.queue = this.queue
      .then(() => this.present(interaction, controller.signal))
      .catch((error: unknown) => {
        this.input.status(`could not answer the question: ${errorMessage(error)}`)
      })
      .finally(() => this.open.delete(interaction.interactionId))
  }

  resolved(interactionId: string) {
    this.open.get(interactionId)?.abort(ANSWERED_ELSEWHERE)
  }

  cancelAll() {
    for (const controller of this.open.values()) controller.abort(RUN_ENDED)
  }

  private async present(interaction: AgentLoopInteraction, signal: AbortSignal) {
    if (signal.aborted) return
    if (interaction.kind === 'notify') {
      this.input.status(`${interaction.level}: ${interaction.message}`)
      return
    }
    if (interaction.kind === 'confirm' && this.input.interactive) {
      await this.confirm(interaction, signal)
      return
    }
    this.input.status(`waiting for an answer: ${describeInteraction(interaction)}`)
    const hint = respondCommandHint(interaction)
    this.input.status(
      hint
        ? `answer it in the OpenWaggle desktop app, or run:\n  ${hint}`
        : 'answer it in the OpenWaggle desktop app.',
    )
  }

  private async confirm(
    interaction: Extract<AgentLoopInteraction, { readonly kind: 'confirm' }>,
    signal: AbortSignal,
  ) {
    this.input.presenter.endReplyLine()
    this.input.output.stderr(`\n${interaction.title}\n${interaction.message}\n`)
    // The prompt is written by readline directly, so earlier queued output must land first.
    await this.input.output.flushed()
    let answer: string
    try {
      answer = await this.input.ask('Allow? [y/N] ', signal)
    } catch (error) {
      if (error instanceof PromptInterruptedError) {
        this.input.output.stderr('\n')
        this.input.onPromptInterrupted()
        return
      }
      if (!signal.aborted) throw error
      this.input.output.stderr('\n')
      if (signal.reason === ANSWERED_ELSEWHERE) {
        this.input.status('the question was answered elsewhere.')
      }
      return
    }
    const result = await this.input.execute({
      ...this.input.clientInput,
      payload: sessionControlPayload({
        operation: isAuthorizationConfirmation(interaction)
          ? 'approval-respond'
          : 'request-respond',
        sessionId: interaction.sessionId,
        runId: interaction.runId,
        interactionId: interaction.interactionId,
        kind: 'confirm',
        response: { kind: 'confirm', accepted: isAffirmativeAnswer(answer) },
      }),
    })
    if (sessionCliResultErrorKind(result)) {
      this.input.status('the answer was not accepted; the question may already be resolved.')
    }
  }
}
