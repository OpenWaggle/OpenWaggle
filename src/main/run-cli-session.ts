import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import {
  isSessionlessHostEvent,
  type SessionHostEventEnvelope,
} from '@shared/types/session-host-event'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { LocalSessionCliClientInput } from './local-session-cli-client'
import { sessionControlPayload } from './run-cli-interactions'
import { RunCliOutput, type RunCliOutputSinks } from './run-cli-output'
import { RunCliPresenter } from './run-cli-presenter'
import { RunCliQuestions } from './run-cli-questions'
import { lookUpRun } from './run-cli-run-lookup'
import {
  classifyStateChange,
  RUN_CLI_INTERRUPTED_EXIT,
  type RunSettlement,
  type RunTarget,
  settlementForTerminalEvent,
} from './run-cli-settlement'
import { SESSION_CLI_EXIT, sessionCliResultErrorKind } from './session-cli-exit-status'
import type {
  LocalSessionWatchInput,
  LocalSessionWatchResult,
} from './session-host/local-session-event-client'
import { sessionsCliStreamRecordLine } from './sessions-cli-output'

export { RUN_CLI_INTERRUPTED_EXIT } from './run-cli-settlement'

/** Events buffered before the launch response names the new Session. */
export const RUN_CLI_PENDING_EVENT_LIMIT = 10_000

export interface RunCliSessionDependencies extends RunCliOutputSinks {
  readonly execute: (
    input: LocalSessionCliClientInput & { readonly payload: LocalSessionCommandPayload },
  ) => Promise<LocalSessionCommandResult>
  readonly watch: (input: LocalSessionWatchInput) => Promise<LocalSessionWatchResult>
  /** Whether questions can be answered from this terminal. */
  readonly interactive: boolean
  readonly ask: (question: string, signal: AbortSignal) => Promise<string>
}

function payloadSessionId(event: SessionHostEventEnvelope) {
  const payload = event.payload
  return isSessionlessHostEvent(payload) ? undefined : payload.sessionId
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One `openwaggle run` invocation. Events that arrive between subscribing and learning the
 * launched Session's identity are buffered, so the first output of the Run is never lost.
 */
export class RunCliSession {
  readonly output: RunCliOutput
  private readonly presenter: RunCliPresenter
  private readonly questions: RunCliQuestions
  private readonly watchAbort = new AbortController()
  private readonly pendingEvents: SessionHostEventEnvelope[] = []
  private readonly preexistingSessions = new Set<string>()
  private pendingEventsOverflowed = false
  private target: RunTarget | null = null
  private interruptRequests = 0
  private interruptDelivery: Promise<boolean> | null = null
  private reconciling: Promise<void> | null = null
  private reconcileAgain = false
  private settled = false
  private otherRunId: string | null = null
  /** The Run's final `agent_end`, used when the Host goes away before settling the Run. */
  private terminalEvent: Extract<AgentTransportEvent, { readonly type: 'agent_end' }> | null = null
  private resolveSettlement: (settlement: RunSettlement) => void = () => undefined
  readonly settlement = new Promise<RunSettlement>((resolve) => {
    this.resolveSettlement = resolve
  })

  constructor(
    private readonly clientInput: LocalSessionCliClientInput,
    private readonly jsonl: boolean,
    private readonly dependencies: RunCliSessionDependencies,
  ) {
    this.output = new RunCliOutput(dependencies, () => this.stdoutClosed())
    this.presenter = new RunCliPresenter({
      reply: (text) => this.output.reply(text),
      stderr: (text) => this.output.stderr(text),
    })
    this.questions = new RunCliQuestions({
      clientInput,
      execute: dependencies.execute,
      ask: dependencies.ask,
      interactive: dependencies.interactive,
      output: this.output,
      presenter: this.presenter,
      status: (text) => this.status(text),
      onPromptInterrupted: () => this.requestInterrupt(),
    })
  }

  /** Progress for people. JSONL consumers get the same facts in the final record. */
  status(text: string) {
    if (!this.jsonl) this.presenter.status(text)
  }

  watch(onSubscribed: () => void) {
    return this.dependencies.watch({
      ...this.clientInput,
      signal: this.watchAbort.signal,
      onSnapshot: (activeRuns) => {
        for (const run of activeRuns) this.preexistingSessions.add(run.sessionId)
      },
      onCursor: onSubscribed,
      onEvent: (event) => {
        if (this.target) this.handle(event, this.target)
        else this.buffer(event)
      },
    })
  }

  private buffer(event: SessionHostEventEnvelope) {
    const sessionId = payloadSessionId(event)
    if (sessionId === undefined || this.preexistingSessions.has(sessionId)) return
    if (this.pendingEvents.length >= RUN_CLI_PENDING_EVENT_LIMIT) {
      this.pendingEventsOverflowed = true
      return
    }
    this.pendingEvents.push(event)
  }

  stopWatching() {
    this.watchAbort.abort()
    this.questions.cancelAll()
  }

  begin(target: RunTarget, input: { readonly projectPath: string; readonly replayed: boolean }) {
    this.target = target
    if (!this.jsonl) {
      this.presenter.started({ sessionId: target.sessionId, projectPath: input.projectPath })
    }
    if (this.pendingEventsOverflowed) {
      this.status("the Session Host was busy, so some of the Run's early output was not shown.")
    }
    for (const event of this.pendingEvents.splice(0)) this.handle(event, target)
    if (this.interruptRequests > 0) this.sendInterrupt(target)
    // A replayed launch returns the original Run, which may already have ended, and dropped
    // events may have included the Run's settlement.
    if (input.replayed || this.pendingEventsOverflowed) void this.reconcile()
  }

  settle(settlement: RunSettlement) {
    this.settled = true
    this.resolveSettlement(settlement)
  }

  hasSettled() {
    return this.settled
  }

  /**
   * How the Run ended according to its last `agent_end`, for when the stream closed before the
   * Host published the settlement, as when a stopping Host exits right after its last Run.
   */
  settlementFromTerminalEvent() {
    return this.terminalEvent ? settlementForTerminalEvent(this.terminalEvent) : undefined
  }

  requestInterrupt() {
    this.interruptRequests += 1
    if (this.interruptRequests > 1) {
      this.settle({ exitCode: RUN_CLI_INTERRUPTED_EXIT, message: 'stopped waiting for the Run.' })
      return
    }
    if (this.target) this.sendInterrupt(this.target)
    else this.status('interrupting once the Run has started…')
  }

  private stdoutClosed() {
    if (this.target) this.sendInterrupt(this.target, { announce: false })
    this.settle({
      exitCode: SESSION_CLI_EXIT.FAILURE,
      message: 'stdout was closed, so the Run was interrupted.',
    })
  }

  private sendInterrupt(target: RunTarget, options = { announce: true }) {
    if (this.interruptDelivery) return
    if (options.announce) this.status('interrupting the Run (press Ctrl-C again to stop waiting)')
    this.interruptDelivery = this.dependencies
      .execute({
        ...this.clientInput,
        payload: sessionControlPayload({
          operation: 'interrupt',
          sessionId: target.sessionId,
          expectedRunId: target.runId,
        }),
      })
      .then((result) => {
        if (!sessionCliResultErrorKind(result)) return true
        this.status('the Run could not be interrupted; it may already have finished.')
        return false
      })
      .catch((error: unknown) => {
        this.status(`interrupt failed: ${errorMessage(error)}`)
        return false
      })
  }

  /** Give an interrupt already in flight a bounded chance to reach the Host before exiting. */
  async interruptDelivered(timeoutMs: number) {
    if (!this.interruptDelivery) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })
    try {
      return await Promise.race([this.interruptDelivery, timedOut])
    } finally {
      clearTimeout(timer)
    }
  }

  private handle(event: SessionHostEventEnvelope, target: RunTarget) {
    if (payloadSessionId(event) !== target.sessionId) return
    const payload = event.payload
    if (!this.belongsToOtherRun(payload, target)) {
      if (this.jsonl) this.output.stdout(sessionsCliStreamRecordLine(event))
      else this.presenter.present(payload)
    }
    if (payload.kind === 'session-transport') {
      this.handleTransport(payload.event, target)
      return
    }
    const change = classifyStateChange(payload, target)
    if (change === 'reconcile') {
      void this.reconcile()
      return
    }
    if (change) this.settle(change)
  }

  /** Output of a Run that replaced ours in the same Session is not this command's output. */
  private belongsToOtherRun(payload: SessionHostEventEnvelope['payload'], target: RunTarget) {
    if (payload.kind !== 'session-transport') return false
    const event = payload.event
    if (event.type === 'agent_start')
      this.otherRunId = event.runId === target.runId ? null : event.runId
    const other = this.otherRunId !== null
    if (event.type === 'agent_end' && event.runId === this.otherRunId) this.otherRunId = null
    return other
  }

  private handleTransport(event: AgentTransportEvent, target: RunTarget) {
    if (event.type === 'agent_end' && event.runId === target.runId && !event.willRetry) {
      this.terminalEvent = event
    }
    if (event.type === 'agent_interaction_request' && event.interaction.runId === target.runId) {
      this.queueInteraction(event.interaction)
    }
    if (event.type === 'agent_interaction_resolved') this.questions.resolved(event.interactionId)
  }

  private queueInteraction(interaction: AgentLoopInteraction) {
    if (this.jsonl && !this.dependencies.interactive) return
    this.questions.enqueue(interaction)
  }

  /**
   * Read the Run's durable status. Replacement, replay, and deletion can end a Run without a
   * settlement event naming it; this catches those cases.
   */
  reconcile() {
    const target = this.target
    if (!target) return this.reconciling ?? Promise.resolve()
    if (this.reconciling) {
      this.reconcileAgain = true
      return this.reconciling
    }
    this.reconciling = this.readRunStatus(target).finally(() => {
      this.reconciling = null
      if (this.reconcileAgain) {
        this.reconcileAgain = false
        void this.reconcile()
      }
    })
    return this.reconciling
  }

  private async readRunStatus(target: RunTarget) {
    try {
      const execute = (payload: LocalSessionCommandPayload) =>
        this.dependencies.execute({ ...this.clientInput, payload })
      const lookup = await lookUpRun(execute, target)
      if (lookup.kind === 'settled') this.settle(lookup.settlement)
      if (lookup.kind === 'unknown')
        this.status(`could not read the Run's status (${lookup.reason})`)
    } catch (error) {
      this.status(`could not read the Run's status: ${errorMessage(error)}`)
    }
  }

  finish(settlement: RunSettlement) {
    if (this.jsonl) {
      this.output.stdout(
        sessionsCliStreamRecordLine({
          kind: 'run-settled',
          sessionId: this.target?.sessionId,
          runId: this.target?.runId,
          exitCode: settlement.exitCode,
          ...(settlement.message ? { message: settlement.message } : {}),
        }),
      )
      return
    }
    this.presenter.endReplyLine()
    if (settlement.message) this.presenter.status(settlement.message)
    if (this.target && this.dependencies.interactive) {
      this.presenter.status(
        `continue with: openwaggle sessions follow-up ${this.target.sessionId} --text "..."`,
      )
    }
  }
}
