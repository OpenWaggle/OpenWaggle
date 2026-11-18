import { matchBy } from '@diegogbrisa/ts-match'
import { hivePendingRequestOf } from '@shared/domain/hive-next-actor'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import type { HivePendingRequest } from '@shared/types/hive-next-actor'
import type {
  SessionHostEventEnvelope,
  SessionHostEventPayload,
} from '@shared/types/session-host-event'
import type { AgentTransportEvent } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import {
  type DesktopNotificationCandidate,
  desktopNotificationOriginPermits,
  runSettlementCandidate,
} from '../../domain/desktop-notifications/desktop-notification-policy'
import type {
  DesktopNotificationFactsShape,
  DesktopNotificationSessionFacts,
} from '../../ports/desktop-notification-facts'
import {
  type DesktopNotificationLedger,
  sessionNotificationTarget,
} from './desktop-notification-ledger'
import {
  type CompletedRootRun,
  originOfRun,
  READY_TO_READ,
  ReadyToReadAfterWorkers,
} from './ready-to-read-after-workers'

/** Settled Runs remembered so a Run is never announced twice; old ones are forgotten. */
const NOTIFIED_RUN_MEMORY = 512

export interface DesktopNotificationObserverDependencies {
  readonly ledger: DesktopNotificationLedger
  readonly facts: DesktopNotificationFactsShape
  /** The strongest request a Run has parked for the person on the Session, if any. */
  readonly pendingRequest: (sessionId: string) => HivePendingRequest | null
}

type StateChanged = Extract<SessionHostEventPayload, { readonly kind: 'session-state-changed' }>
type ListChanged = Extract<SessionHostEventPayload, { readonly kind: 'session-list-changed' }>

function interactionPreview(interaction: AgentLoopInteraction) {
  return matchBy(interaction, 'kind')
    .with('confirm', (confirm) => [confirm.title, confirm.message].filter(Boolean).join(': '))
    .with('select', 'input', 'editor', (prompt) => prompt.title)
    .with('custom', (custom) => custom.customType)
    .with('notify', (notify) => notify.message)
    .exhaustive()
}

function needsYouReason(request: HivePendingRequest) {
  return request === 'approval' ? ('awaiting-approval' as const) : ('awaiting-answer' as const)
}

/**
 * Reads the Session Host's own events and decides which Desktop notification each one is due
 * (ADR 0062, CONTEXT.md): Needs you for every Session, Ready to read, Failed or interrupted and
 * Agent errors for a root Session's Runs that the person or a Scheduled task started. Ready to
 * read waits for the root's Running Workers (ADR 0065): a reply that leaves Workers running, or a
 * Hive wake still coming, is held per root Session and shown once its Hive settles.
 */
export class DesktopNotificationObserver {
  private readonly lastReply = new Map<string, string>()
  private readonly lastError = new Map<string, string>()
  private readonly notifiedRuns = new Set<string>()
  private readonly readyToRead: ReadyToReadAfterWorkers

  private readonly dependencies: DesktopNotificationObserverDependencies

  constructor(dependencies: DesktopNotificationObserverDependencies) {
    this.dependencies = dependencies
    this.readyToRead = new ReadyToReadAfterWorkers(dependencies)
  }

  handle(envelope: SessionHostEventEnvelope) {
    return this.decide(envelope).pipe(
      Effect.catchAllCause((cause) =>
        Effect.logWarning('A Desktop notification decision failed', cause),
      ),
    ) satisfies Effect.Effect<void>
  }

  /** Whether this Run was already announced; marks it announced either way. */
  claimRun(runId: string) {
    if (this.notifiedRuns.has(runId)) return false
    this.notifiedRuns.add(runId)
    if (this.notifiedRuns.size > NOTIFIED_RUN_MEMORY) {
      const oldest = this.notifiedRuns.values().next()
      if (!oldest.done) this.notifiedRuns.delete(oldest.value)
    }
    return true
  }

  /** Workers' outcomes go to their parent; only a root Session's Run reaches the person. */
  forRootRun(
    sessionId: string,
    runId: string,
    candidate: DesktopNotificationCandidate,
    show: (session: DesktopNotificationSessionFacts) => Effect.Effect<void, unknown>,
  ) {
    return Effect.gen(this, function* () {
      const session = yield* this.dependencies.facts.session(sessionId)
      if (!session || session.archived || session.parentSessionId !== null) return
      const run = yield* this.dependencies.facts.run(sessionId, runId)
      if (!desktopNotificationOriginPermits(originOfRun(run), candidate)) return
      yield* show(session)
    })
  }

  private decide({ payload, timestamp }: SessionHostEventEnvelope) {
    const effect: Effect.Effect<void, unknown> = matchBy(payload, 'kind')
      .with('session-transport', 'session-waggle-transport', (transport) =>
        this.onTransport(transport.sessionId, transport.event, timestamp),
      )
      .with('session-state-changed', (changed) => this.onStateChanged(changed, timestamp))
      .with('session-list-changed', (changed) => this.onListChanged(changed))
      .otherwise(() => Effect.void)
    return effect
  }

  private onTransport(sessionId: string, event: AgentTransportEvent, occurredAt: number) {
    return matchBy(event, 'type')
      .with('agent_start', () => {
        this.lastReply.delete(sessionId)
        this.lastError.delete(sessionId)
        return Effect.void
      })
      .with('message_update', (update) => {
        if (update.assistantMessageEvent.type === 'text_end') {
          this.lastReply.set(sessionId, update.assistantMessageEvent.content)
        }
        return Effect.void
      })
      .with('message_end', (end) => {
        if (end.role === 'assistant' && end.errorMessage) {
          this.lastError.set(sessionId, end.errorMessage)
        }
        return Effect.void
      })
      .with('agent_interaction_request', (request) =>
        this.onInteractionRequest(sessionId, request.interaction, occurredAt),
      )
      .with('agent_interaction_resolved', () => this.onInteractionResolved(sessionId))
      .otherwise(() => Effect.void)
  }

  private onInteractionRequest(
    sessionId: string,
    interaction: AgentLoopInteraction,
    occurredAt: number,
  ) {
    if (interaction.kind === 'notify') {
      return interaction.level === 'error'
        ? this.onAgentError(sessionId, interaction.runId, interaction.message, occurredAt)
        : Effect.void
    }
    const request = hivePendingRequestOf(interaction)
    if (request === null) return Effect.void
    return Effect.gen(this, function* () {
      const session = yield* this.dependencies.facts.session(sessionId)
      if (!session || session.archived) return
      // Needs you notifies for every Session, Workers included, whoever started the Run.
      yield* this.dependencies.ledger.show({
        target: sessionNotificationTarget(sessionId),
        candidate: { category: 'needs-you', reason: needsYouReason(request) },
        subject: { sessionId, projectPath: session.projectPath },
        title: session,
        preview: interactionPreview(interaction),
        occurredAt,
      })
    })
  }

  private onInteractionResolved(sessionId: string) {
    const target = sessionNotificationTarget(sessionId)
    const standing = this.dependencies.ledger.get(target)
    if (standing?.category !== 'needs-you' || standing.reason === 'stuck') return Effect.void
    if (this.dependencies.pendingRequest(sessionId) !== null) return Effect.void
    return this.dependencies.ledger.withdraw(target)
  }

  private onAgentError(sessionId: string, runId: string, message: string, occurredAt: number) {
    const candidate = { category: 'agent-errors', reason: 'agent-error' } as const
    // One Agent error per Run: an extension that keeps failing does not keep notifying.
    if (!this.claimRun(`agent-error:${runId}`)) return Effect.void
    return this.forRootRun(sessionId, runId, candidate, (session) =>
      this.dependencies.ledger.show({
        target: sessionNotificationTarget(sessionId),
        candidate,
        subject: { sessionId, projectPath: session.projectPath },
        title: session,
        preview: message,
        occurredAt,
      }),
    )
  }

  private onStateChanged(payload: StateChanged, occurredAt: number) {
    const { runId, terminalStatus, sessionId } = payload
    if (payload.operation !== 'run-settled' && payload.operation !== 'follow-up-started') {
      return Effect.void
    }
    if (!runId || !terminalStatus) return Effect.void
    const candidate = runSettlementCandidate(terminalStatus)
    // A Session that went straight on to a queued Follow-up is not ready to read yet.
    const continuing =
      payload.operation === 'follow-up-started' && candidate?.category === 'ready-to-read'
    const ended =
      terminalStatus === 'completed'
        ? Effect.void
        : this.readyToRead.ended(sessionId, runId, candidate)
    return ended.pipe(
      Effect.zipRight(
        Effect.suspend(() => this.afterSettlement(payload, candidate, continuing, occurredAt)),
      ),
    )
  }

  private afterSettlement(
    payload: StateChanged,
    candidate: DesktopNotificationCandidate | null,
    continuing: boolean,
    occurredAt: number,
  ) {
    const { runId, sessionId } = payload
    if (!runId) {
      const effect: Effect.Effect<void, unknown> = Effect.void
      return effect
    }
    if (!candidate || continuing || !this.claimRun(runId)) {
      return this.readyToRead.settle(sessionId, occurredAt, runId)
    }
    const preview =
      (candidate.category === 'ready-to-read'
        ? this.lastReply.get(sessionId)
        : this.lastError.get(sessionId)) ?? null
    this.lastReply.delete(sessionId)
    this.lastError.delete(sessionId)
    if (candidate.category === 'ready-to-read') {
      return this.onCompleted({
        sessionId,
        runId,
        hiveWake: payload.hiveWake === true,
        preview,
        occurredAt,
      })
    }
    const effect: Effect.Effect<void, unknown> = this.forRootRun(
      sessionId,
      runId,
      candidate,
      (session) =>
        this.dependencies.ledger.show({
          target: sessionNotificationTarget(sessionId),
          candidate,
          subject: { sessionId, projectPath: session.projectPath },
          title: session,
          preview,
          occurredAt,
        }),
    ).pipe(Effect.zipRight(this.readyToRead.settle(sessionId, occurredAt, runId)))
    return effect
  }

  /** A root Session's Run completed: Ready to read now, or once its Hive settles (ADR 0065). */
  private onCompleted(completed: CompletedRootRun) {
    const { sessionId, runId, occurredAt } = completed
    return Effect.gen(this, function* () {
      const { facts } = this.dependencies
      const session = yield* facts.session(sessionId)
      // A Worker's Run reaches its parent; it may still be the last Run its Hive waited for,
      // even when the Worker was archived while it ran.
      if (session?.parentSessionId !== null) {
        return yield* this.readyToRead.settle(sessionId, occurredAt, runId)
      }
      if (session.archived) return
      const run = yield* facts.run(sessionId, runId)
      if (!desktopNotificationOriginPermits(originOfRun(run), READY_TO_READ)) {
        return yield* this.readyToRead.settleRoot(sessionId, occurredAt, runId)
      }
      yield* this.readyToRead.completed(session, {
        ...completed,
        startedAt: run?.startedAt ?? null,
      })
    })
  }

  /**
   * Re-checks every held Ready to read. A Hive wake that was expected but never started (refused,
   * deferred and dropped, or the Host draining) settles no Run, so nothing else would show it.
   */
  settleHeldReadyToRead(at: number, runLimitFull: boolean) {
    return this.readyToRead.settleHeld(at, runLimitFull)
  }

  /** Whether a Ready to read is held for any root, waiting for its Hive to settle. */
  get holdingReadyToRead() {
    return this.readyToRead.holding
  }

  private onListChanged(payload: ListChanged) {
    if (payload.change === 'archived' || payload.change === 'deleted') {
      this.readyToRead.drop(payload.sessionId)
      this.lastReply.delete(payload.sessionId)
      this.lastError.delete(payload.sessionId)
      return this.dependencies.ledger.withdraw(sessionNotificationTarget(payload.sessionId))
    }
    // A visit receipt is an update; the ledger reads it only for a standing notification.
    if (payload.change !== 'updated') return Effect.void
    return this.dependencies.ledger.withdrawIfVisited(payload.sessionId)
  }
}
