import { randomUUID } from 'node:crypto'
import type { LocalSessionServerFrame } from '@shared/types/local-session-protocol'
import type { SessionHostEventCursor } from '@shared/types/session-host-event'
import type { LocalSessionAdmissionGate } from './local-session-admission-gate'
import { createLocalSessionEventAdmissionFilter } from './local-session-event-admission'
import type { LocalSessionEventCursorProjection } from './local-session-event-cursor-projection'
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
  readonly cursorProjection: LocalSessionEventCursorProjection
  readonly caller: () => AuthenticatedLocalSessionCaller | null
  readonly negotiatedRevision: () => number | null
  readonly closed: () => boolean
  readonly send: (frame: LocalSessionServerFrame | unknown) => Promise<void>
  readonly connectionFailed: () => void
}

export class LocalSessionConnectionSubscriptions {
  private readonly subscriptions = new Map<string, ActiveLocalSessionSubscription>()
  private readonly provisionals = new Set<() => void>()

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
    let releaseLiveness: (() => void) | undefined
    let provisionalSubscription: ActiveLocalSessionSubscription['subscription'] | undefined
    const releaseProvisional = () => {
      provisionalSubscription?.close()
      provisionalSubscription = undefined
      releaseBudget?.()
      releaseBudget = undefined
    }
    try {
      const caller = this.input.caller()
      if (!caller) return true
      const admissionEpoch = this.input.admission.currentEpoch()
      const cursorResolution = cursor
        ? this.input.cursorProjection.resolve(caller, cursor)
        : {
            status: 'ready' as const,
            cursor: this.input.cursorProjection.bindReplayCursor(
              caller,
              this.input.dependencies.eventHub.cursor(),
            ),
          }
      if (cursorResolution.status === 'resync-required') {
        await this.input.send({
          kind: 'resync-required',
          requestId,
          reason: cursorResolution.reason,
          cursor: cursorResolution.cursor,
        })
        return true
      }
      const snapshotCursor = cursorResolution.cursor
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
          this.input.negotiatedRevision() ?? undefined,
        ),
        { advanceFilteredCursor: true },
      )
      if (result.status === 'resync-required') {
        await this.input.send({
          kind: 'resync-required',
          requestId,
          reason: result.reason,
          cursor: this.input.cursorProjection.expose(caller, result.cursor),
        })
        return true
      }
      provisionalSubscription = result.subscription
      this.provisionals.add(releaseProvisional)
      const activeRuns = await this.authorizedActiveRuns(caller, cursor, sessionIds)
      if (
        this.input.closed() ||
        this.input.admission.isFenced() ||
        admissionEpoch !== this.input.admission.currentEpoch()
      ) {
        return false
      }
      const subscriptionId = randomUUID()
      releaseLiveness = this.input.dependencies.liveness.acquire('subscription')
      const active = {
        subscription: result.subscription,
        releaseLiveness,
        releaseBudget,
      } satisfies ActiveLocalSessionSubscription
      this.subscriptions.set(subscriptionId, active)
      releaseBudget = undefined
      releaseLiveness = undefined
      provisionalSubscription = undefined
      this.provisionals.delete(releaseProvisional)
      await this.input.send({
        kind: 'subscribed',
        requestId,
        subscriptionId,
        cursor: this.input.cursorProjection.expose(caller, snapshotCursor),
        ...(activeRuns ? { activeRuns } : {}),
      })
      void this.pump(subscriptionId, active)
      return true
    } finally {
      this.provisionals.delete(releaseProvisional)
      releaseProvisional()
      releaseLiveness?.()
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
    for (const release of this.provisionals) release()
    this.provisionals.clear()
    for (const active of this.subscriptions.values()) {
      active.subscription.close()
      active.releaseLiveness()
      active.releaseBudget()
    }
    this.subscriptions.clear()
  }

  requireResync() {
    for (const active of this.subscriptions.values()) {
      active.subscription.requireResync('cursor-expired')
    }
  }

  private async sendFrame(subscriptionId: string, frame: LocalSessionSubscriptionPumpFrame) {
    if (frame.kind === 'subscription-closed') {
      const caller = this.input.caller()
      if (!caller) return
      return this.input.send({ ...frame, subscriptionId })
    }
    if (frame.kind === 'resync-required') {
      while (!this.input.closed()) {
        await this.input.admission.waitUntilReady()
        const releaseAdmissionReader = this.input.admission.acquireReader(this.input.closed())
        if (!releaseAdmissionReader) continue
        try {
          const caller = this.input.caller()
          if (!caller) return
          return await this.input.send({
            ...frame,
            subscriptionId,
            cursor: this.input.cursorProjection.expose(caller, frame.cursor),
          })
        } finally {
          releaseAdmissionReader()
        }
      }
      return
    }
    if (frame.kind === 'cursor-advanced') {
      const releaseAdmissionReader = this.input.admission.acquireReader(this.input.closed())
      if (!releaseAdmissionReader) return
      try {
        const caller = this.input.caller()
        if (caller && !this.input.admission.isFenced()) {
          await this.input.send({
            kind: 'cursor-advanced',
            subscriptionId,
            cursor: this.input.cursorProjection.expose(caller, frame.cursor),
          })
        }
      } finally {
        releaseAdmissionReader()
      }
      return
    }
    const releaseAdmissionReader = this.input.admission.acquireReader(this.input.closed())
    if (!releaseAdmissionReader) return
    try {
      const caller = this.input.caller()
      const denied =
        this.input.admission.isFenced() ||
        (await localSessionEventIsDenied(
          caller,
          this.input.dependencies.authorizeEvent,
          frame.event,
        ))
      if (!denied && caller) {
        await this.input.send({
          ...frame,
          subscriptionId,
          event: this.input.cursorProjection.exposeEvent(caller, frame.event),
        })
      }
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
