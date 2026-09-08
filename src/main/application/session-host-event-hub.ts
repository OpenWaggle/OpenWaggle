import { randomUUID } from 'node:crypto'
import type {
  SessionHostEventCursor,
  SessionHostEventEnvelope,
  SessionHostEventPayload,
  SessionHostEventReplayResult,
} from '@shared/types/session-host-event'
import {
  type SessionHostEventReplayView,
  SessionHostEventReplayViews,
} from './session-host-event-replay-views'
import {
  type RetainedReplayResult,
  SessionHostEventReplayWindow,
} from './session-host-event-replay-window'
import { SessionHostEventSubscription } from './session-host-event-subscription'

export { SessionHostEventSubscription } from './session-host-event-subscription'

const DEFAULT_REPLAY_CAPACITY = 4096
const DEFAULT_SUBSCRIBER_CAPACITY = 256
const DEFAULT_REPLAY_BYTE_CAPACITY = 32 * 1024 * 1024
const DEFAULT_SUBSCRIBER_BYTE_CAPACITY = 4 * 1024 * 1024
const DEFAULT_SUBSCRIBER_AGGREGATE_BYTE_CAPACITY = 32 * 1024 * 1024

export interface SessionHostEventHubOptions {
  readonly hostInstanceId?: string
  readonly replayCapacity?: number
  readonly subscriberCapacity?: number
  readonly replayByteCapacity?: number
  readonly subscriberByteCapacity?: number
  readonly subscriberAggregateByteCapacity?: number
  readonly now?: () => number
}

export type SessionHostSubscriptionResult =
  | { readonly status: 'ready'; readonly subscription: SessionHostEventSubscription }
  | Extract<SessionHostEventReplayResult, { readonly status: 'resync-required' }>

export class SessionHostEventHub {
  readonly hostInstanceId: string
  private readonly replayCapacity: number
  private readonly subscriberCapacity: number
  private readonly replayByteCapacity: number
  private readonly subscriberByteCapacity: number
  private readonly subscriberAggregateByteCapacity: number
  private readonly now: () => number
  private sequence = 0
  private readonly replayWindow: SessionHostEventReplayWindow
  private retainedSubscriberBytes = 0
  private readonly subscribers = new Set<SessionHostEventSubscription>()
  private readonly replayViews: SessionHostEventReplayViews

  constructor(options: SessionHostEventHubOptions = {}) {
    this.hostInstanceId = options.hostInstanceId ?? randomUUID()
    this.replayCapacity = options.replayCapacity ?? DEFAULT_REPLAY_CAPACITY
    this.subscriberCapacity = options.subscriberCapacity ?? DEFAULT_SUBSCRIBER_CAPACITY
    this.replayByteCapacity = options.replayByteCapacity ?? DEFAULT_REPLAY_BYTE_CAPACITY
    this.subscriberByteCapacity = options.subscriberByteCapacity ?? DEFAULT_SUBSCRIBER_BYTE_CAPACITY
    this.subscriberAggregateByteCapacity =
      options.subscriberAggregateByteCapacity ?? DEFAULT_SUBSCRIBER_AGGREGATE_BYTE_CAPACITY
    this.now = options.now ?? Date.now
    this.replayViews = new SessionHostEventReplayViews(this.hostInstanceId)
    this.assertPositiveCapacity(this.replayCapacity, 'replay')
    this.assertPositiveCapacity(this.subscriberCapacity, 'subscriber')
    this.assertPositiveCapacity(this.replayByteCapacity, 'replay bytes')
    this.assertPositiveCapacity(this.subscriberByteCapacity, 'subscriber bytes')
    this.assertPositiveCapacity(this.subscriberAggregateByteCapacity, 'aggregate subscriber bytes')
    this.replayWindow = new SessionHostEventReplayWindow(
      this.replayCapacity,
      this.replayByteCapacity,
    )
  }

  private assertPositiveCapacity(capacity: number, name: string) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error(`Session Host event ${name} capacity must be a positive safe integer.`)
    }
  }

  cursor(): SessionHostEventCursor {
    return { hostInstanceId: this.hostInstanceId, sequence: this.sequence }
  }

  replayLimits() {
    return { capacity: this.replayCapacity, byteCapacity: this.replayByteCapacity }
  }

  createReplayView(
    accepts: (event: SessionHostEventEnvelope) => boolean,
    limits: { readonly capacity: number; readonly byteCapacity: number },
  ) {
    return this.replayViews.create(this.sequence, accepts, limits)
  }

  rotateReplayView(view: SessionHostEventReplayView) {
    return this.replayViews.rotate(view)
  }

  subscriberCount(): number {
    return this.subscribers.size
  }

  publish(payload: SessionHostEventPayload): SessionHostEventEnvelope {
    this.sequence += 1
    const event = {
      cursor: this.cursor(),
      timestamp: this.now(),
      payload,
    } satisfies SessionHostEventEnvelope
    const bytes = Buffer.byteLength(JSON.stringify(event), 'utf8')
    if (bytes <= this.replayByteCapacity) {
      this.replayWindow.push({ event, bytes })
    } else {
      this.replayWindow.clear()
    }
    this.replayViews.record(event, bytes)
    for (const subscriber of this.subscribers) subscriber.enqueue(event, bytes)
    return event
  }

  replayAfter(cursor: SessionHostEventCursor): SessionHostEventReplayResult {
    const replay = this.#retainedReplayAfter(cursor)
    return replay.status === 'ready'
      ? {
          status: 'ready',
          events: replay.entries.map((entry) => entry.event),
          cursor: replay.cursor,
        }
      : replay
  }

  #retainedReplayAfter(cursor: SessionHostEventCursor): RetainedReplayResult {
    const current = this.cursor()
    const restricted = this.replayViews.retainedReplayAfter(cursor, current)
    if (restricted) return restricted
    if (cursor.hostInstanceId !== this.hostInstanceId) {
      return { status: 'resync-required', reason: 'host-restarted', cursor: current }
    }
    if (cursor.sequence > this.sequence) {
      return { status: 'resync-required', reason: 'cursor-ahead', cursor: current }
    }
    const oldestSequence = this.replayWindow.first()?.event.cursor.sequence ?? this.sequence + 1
    if (cursor.sequence < oldestSequence - 1) {
      return { status: 'resync-required', reason: 'cursor-expired', cursor: current }
    }
    return {
      status: 'ready' as const,
      entries: this.replayWindow.after(cursor.sequence),
      cursor: current,
    }
  }

  subscribeAfter(
    cursor: SessionHostEventCursor = this.cursor(),
    accepts: (event: SessionHostEventEnvelope) => boolean = () => true,
    options: { readonly advanceFilteredCursor?: boolean } = {},
  ): SessionHostSubscriptionResult {
    const replay = this.#retainedReplayAfter(cursor)
    if (replay.status === 'resync-required') return replay
    const replayView = this.replayViews.viewFor(cursor)
    const effectiveAccepts = replayView
      ? (event: SessionHostEventEnvelope) => replayView.acceptsEvent(event) && accepts(event)
      : accepts
    const visibleReplay = replay.entries.filter((entry) => effectiveAccepts(entry.event))
    const replayBytes = visibleReplay.reduce((total, entry) => total + entry.bytes, 0)
    if (
      visibleReplay.length > this.subscriberCapacity ||
      replayBytes > this.subscriberByteCapacity ||
      this.retainedSubscriberBytes + replayBytes > this.subscriberAggregateByteCapacity
    ) {
      return {
        status: 'resync-required',
        reason: 'slow-consumer',
        cursor: replay.cursor,
      }
    }

    const subscription = new SessionHostEventSubscription(
      this.subscriberCapacity,
      this.subscriberByteCapacity,
      () => this.cursor(),
      () => {
        this.subscribers.delete(subscription)
        replayView?.detach(subscription)
      },
      effectiveAccepts,
      options.advanceFilteredCursor ?? false,
      (bytes) => {
        if (this.retainedSubscriberBytes + bytes > this.subscriberAggregateByteCapacity) {
          return false
        }
        this.retainedSubscriberBytes += bytes
        return true
      },
      (bytes) => {
        this.retainedSubscriberBytes = Math.max(0, this.retainedSubscriberBytes - bytes)
      },
    )
    for (const entry of replay.entries) {
      subscription.enqueue(entry.event, entry.bytes)
    }
    this.subscribers.add(subscription)
    replayView?.attach(subscription)
    return { status: 'ready', subscription }
  }

  close(): void {
    for (const subscription of [...this.subscribers]) subscription.close()
    this.replayViews.close()
  }
}
