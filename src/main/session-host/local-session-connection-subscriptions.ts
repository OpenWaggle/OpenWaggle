import { randomUUID } from 'node:crypto'
import type { LocalSessionServerFrame } from '@shared/types/local-session-protocol'
import type { SessionHostEventCursor } from '@shared/types/session-host-event'
import type { LocalSessionAdmissionGate } from './local-session-admission-gate'
import { createLocalSessionEventAdmissionFilter } from './local-session-event-admission'
import { subscriptionLimitReached } from './local-session-resource-policy'
import type {
  AuthenticatedLocalSessionCaller,
  LocalSessionServerDependencies,
} from './local-session-server'
import {
  type ActiveLocalSessionSubscription,
  type LocalSessionSubscriptionPumpFrame,
  localSessionEventIsDenied,
  pumpLocalSessionSubscription,
} from './local-session-subscription-pump'

interface LocalSessionConnectionSubscriptionsInput {
  readonly dependencies: LocalSessionServerDependencies
  readonly admission: LocalSessionAdmissionGate
  readonly caller: () => AuthenticatedLocalSessionCaller | null
  readonly closed: () => boolean
  readonly send: (frame: LocalSessionServerFrame | unknown) => Promise<void>
  readonly connectionFailed: () => void
}

export class LocalSessionConnectionSubscriptions {
  private readonly subscriptions = new Map<string, ActiveLocalSessionSubscription>()

  constructor(private readonly input: LocalSessionConnectionSubscriptionsInput) {}

  async subscribe(
    requestId: string,
    cursor?: SessionHostEventCursor,
    sessionIds?: readonly string[],
  ) {
    if (await this.connectionLimitReached(requestId)) return
    while (!this.input.closed()) {
      await this.input.admission.waitUntilReady()
      if (await this.subscribeWhenReady(requestId, cursor, sessionIds)) return
    }
  }

  private async subscribeWhenReady(
    requestId: string,
    cursor?: SessionHostEventCursor,
    sessionIds?: readonly string[],
  ) {
    const releaseAdmissionReader = this.input.admission.acquireReader(this.input.closed())
    if (!releaseAdmissionReader) return false
    let releaseBudget: (() => void) | undefined
    try {
      const caller = this.input.caller()
      if (!caller) return true
      const admissionEpoch = this.input.admission.currentEpoch()
      const snapshotCursor = cursor ?? this.input.dependencies.eventHub.cursor()
      releaseBudget = this.input.dependencies.subscriptionBudget?.reserve()
      if (!releaseBudget) {
        await this.sendLimitReached(requestId)
        return true
      }
      const result = this.input.dependencies.eventHub.subscribeAfter(
        snapshotCursor,
        createLocalSessionEventAdmissionFilter(
          () => (this.input.admission.isFenced() ? null : this.input.caller()),
          sessionIds,
        ),
      )
      if (result.status === 'resync-required') {
        await this.input.send({
          kind: 'resync-required',
          requestId,
          reason: result.reason,
          cursor: result.cursor,
        })
        return true
      }
      const activeRuns = await this.authorizedActiveRuns(caller, cursor, sessionIds)
      if (
        this.input.admission.isFenced() ||
        admissionEpoch !== this.input.admission.currentEpoch()
      ) {
        result.subscription.close()
        return false
      }
      const subscriptionId = randomUUID()
      const active = {
        subscription: result.subscription,
        releaseLiveness: this.input.dependencies.liveness.acquire('subscription'),
        releaseBudget,
      } satisfies ActiveLocalSessionSubscription
      releaseBudget = undefined
      this.subscriptions.set(subscriptionId, active)
      await this.input.send({
        kind: 'subscribed',
        requestId,
        subscriptionId,
        cursor: snapshotCursor,
        ...(activeRuns ? { activeRuns } : {}),
      })
      void this.pump(subscriptionId, active)
      return true
    } finally {
      releaseBudget?.()
      releaseAdmissionReader()
    }
  }

  private async authorizedActiveRuns(
    caller: AuthenticatedLocalSessionCaller,
    cursor?: SessionHostEventCursor,
    sessionIds?: readonly string[],
  ) {
    if (cursor) return
    const requested = sessionIds && sessionIds.length > 0 ? new Set(sessionIds) : undefined
    const snapshots = (this.input.dependencies.snapshotActiveRuns?.() ?? []).filter(
      (snapshot) => !requested || requested.has(snapshot.sessionId),
    )
    const authorization = await Promise.all(
      snapshots.map(async (snapshot) => ({
        snapshot,
        authorized: (await this.input.dependencies.authorizeActiveRun?.(caller, snapshot)) ?? true,
      })),
    )
    return authorization.filter((entry) => entry.authorized).map((entry) => entry.snapshot)
  }

  private async connectionLimitReached(requestId: string) {
    if (!subscriptionLimitReached(this.input.dependencies, this.subscriptions.size)) return false
    await this.sendLimitReached(requestId)
    return true
  }

  private sendLimitReached(requestId: string) {
    return this.input.send({
      kind: 'error',
      requestId,
      code: 'subscription_limit_exceeded',
      message: 'The Local Session subscription limit was reached.',
      retryable: true,
    })
  }

  async unsubscribe(requestId: string, subscriptionId: string) {
    const active = this.subscriptions.get(subscriptionId)
    if (active) {
      this.subscriptions.delete(subscriptionId)
      active.subscription.close()
      active.releaseLiveness()
      active.releaseBudget()
    }
    await this.input.send({ kind: 'unsubscribed', requestId, subscriptionId })
  }

  close() {
    for (const active of this.subscriptions.values()) {
      active.subscription.close()
      active.releaseLiveness()
      active.releaseBudget()
    }
    this.subscriptions.clear()
  }

  private async sendFrame(subscriptionId: string, frame: LocalSessionSubscriptionPumpFrame) {
    if (frame.kind !== 'event') return this.input.send({ ...frame, subscriptionId })
    const releaseAdmissionReader = this.input.admission.acquireReader(this.input.closed())
    if (!releaseAdmissionReader) return
    try {
      const denied =
        this.input.admission.isFenced() ||
        (await localSessionEventIsDenied(
          this.input.caller(),
          this.input.dependencies.authorizeEvent,
          frame.event,
        ))
      if (!denied) await this.input.send({ ...frame, subscriptionId })
    } finally {
      releaseAdmissionReader()
    }
  }

  private async pump(subscriptionId: string, active: ActiveLocalSessionSubscription) {
    try {
      await pumpLocalSessionSubscription({
        subscription: active.subscription,
        active: () => this.subscriptions.get(subscriptionId) === active,
        closed: this.input.closed,
        eventIsDenied: () => Promise.resolve(false),
        send: (frame) => this.sendFrame(subscriptionId, frame),
      })
    } catch {
      this.input.connectionFailed()
    } finally {
      if (this.subscriptions.get(subscriptionId) === active) {
        this.subscriptions.delete(subscriptionId)
      }
      active.subscription.close()
      active.releaseLiveness()
      active.releaseBudget()
    }
  }
}
