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

  async subscribe(requestId: string, cursor?: SessionHostEventCursor) {
    if (subscriptionLimitReached(this.input.dependencies, this.subscriptions.size)) {
      await this.input.send({
        kind: 'error',
        requestId,
        code: 'subscription_limit_exceeded',
        message: 'The Local Session subscription limit was reached.',
        retryable: true,
      })
      return
    }
    while (!this.input.closed()) {
      await this.input.admission.waitUntilReady()
      const releaseAdmissionReader = this.input.admission.acquireReader(this.input.closed())
      if (!releaseAdmissionReader) continue
      try {
        const caller = this.input.caller()
        if (!caller) return
        const admissionEpoch = this.input.admission.currentEpoch()
        const snapshotCursor = cursor ?? this.input.dependencies.eventHub.cursor()
        const result = this.input.dependencies.eventHub.subscribeAfter(
          snapshotCursor,
          createLocalSessionEventAdmissionFilter(() =>
            this.input.admission.isFenced() ? null : this.input.caller(),
          ),
          { advanceFilteredCursor: true },
        )
        if (result.status === 'resync-required') {
          await this.input.send({
            kind: 'resync-required',
            requestId,
            reason: result.reason,
            cursor: result.cursor,
          })
          return
        }
        const activeRunSnapshot = cursor
          ? undefined
          : (this.input.dependencies.snapshotActiveRuns?.() ?? [])
        const activeRuns = activeRunSnapshot
          ? (
              await Promise.all(
                activeRunSnapshot.map(async (snapshot) => ({
                  snapshot,
                  authorized:
                    (await this.input.dependencies.authorizeActiveRun?.(caller, snapshot)) ?? true,
                })),
              )
            )
              .filter((entry) => entry.authorized)
              .map((entry) => entry.snapshot)
          : undefined
        if (
          this.input.admission.isFenced() ||
          admissionEpoch !== this.input.admission.currentEpoch()
        ) {
          result.subscription.close()
        } else {
          const subscriptionId = randomUUID()
          const active = {
            subscription: result.subscription,
            releaseLiveness: this.input.dependencies.liveness.acquire('subscription'),
          } satisfies ActiveLocalSessionSubscription
          this.subscriptions.set(subscriptionId, active)
          await this.input.send({
            kind: 'subscribed',
            requestId,
            subscriptionId,
            cursor: snapshotCursor,
            ...(activeRuns ? { activeRuns } : {}),
          })
          void this.pump(subscriptionId, active)
          return
        }
      } finally {
        releaseAdmissionReader()
      }
    }
  }

  async unsubscribe(requestId: string, subscriptionId: string) {
    const active = this.subscriptions.get(subscriptionId)
    if (active) {
      this.subscriptions.delete(subscriptionId)
      active.subscription.close()
      active.releaseLiveness()
    }
    await this.input.send({ kind: 'unsubscribed', requestId, subscriptionId })
  }

  close() {
    for (const active of this.subscriptions.values()) {
      active.subscription.close()
      active.releaseLiveness()
    }
    this.subscriptions.clear()
  }

  private async sendFrame(subscriptionId: string, frame: LocalSessionSubscriptionPumpFrame) {
    if (frame.kind !== 'event') return this.input.send({ ...frame, subscriptionId })
    const releaseAdmissionReader = this.input.admission.acquireReader(this.input.closed())
    if (!releaseAdmissionReader) {
      return this.input.send({
        kind: 'cursor-advanced',
        subscriptionId,
        cursor: frame.event.cursor,
      })
    }
    try {
      await this.input.send({ ...frame, subscriptionId })
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
        eventIsDenied: (event) =>
          this.input.admission.isFenced()
            ? Promise.resolve(true)
            : localSessionEventIsDenied(
                this.input.caller(),
                this.input.dependencies.authorizeEvent,
                event,
              ),
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
    }
  }
}
