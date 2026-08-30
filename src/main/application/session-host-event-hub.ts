import { randomUUID } from 'node:crypto'
import type {
  SessionHostEventCursor,
  SessionHostEventDelivery,
  SessionHostEventEnvelope,
  SessionHostEventPayload,
  SessionHostEventReplayResult,
} from '@shared/types/session-host-event'

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

export class SessionHostEventSubscription {
  private readonly pending: (
    | { readonly status: 'event'; readonly event: SessionHostEventEnvelope; readonly bytes: number }
    | { readonly status: 'cursor-advanced'; readonly cursor: SessionHostEventCursor }
  )[] = []
  private pendingEventCount = 0
  private pendingBytes = 0
  private waiter: ((delivery: SessionHostEventDelivery) => void) | null = null
  private terminal: SessionHostEventDelivery | null = null

  constructor(
    private readonly capacity: number,
    private readonly byteCapacity: number,
    private readonly currentCursor: () => SessionHostEventCursor,
    private readonly onClose: () => void,
    private readonly accepts: (event: SessionHostEventEnvelope) => boolean,
    private readonly advanceFilteredCursor: boolean,
    private readonly reserveAggregateBytes: (bytes: number) => boolean,
    private readonly releaseAggregateBytes: (bytes: number) => void,
  ) {}

  enqueue(event: SessionHostEventEnvelope, bytes: number): void {
    if (this.terminal) return
    if (!this.accepts(event)) {
      if (this.advanceFilteredCursor) this.enqueueCursorAdvance(event.cursor)
      return
    }
    if (bytes > this.byteCapacity) {
      this.requireResync()
      return
    }
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter({ status: 'event', event })
      return
    }
    if (this.pendingEventCount >= this.capacity || this.pendingBytes + bytes > this.byteCapacity) {
      this.requireResync()
      return
    }
    if (!this.reserveAggregateBytes(bytes)) {
      this.requireResync()
      return
    }
    this.pending.push({ status: 'event', event, bytes })
    this.pendingEventCount += 1
    this.pendingBytes += bytes
  }

  private enqueueCursorAdvance(cursor: SessionHostEventCursor): void {
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter({ status: 'cursor-advanced', cursor })
      return
    }
    const last = this.pending.at(-1)
    if (last?.status === 'cursor-advanced') {
      this.pending[this.pending.length - 1] = { status: 'cursor-advanced', cursor }
      return
    }
    this.pending.push({ status: 'cursor-advanced', cursor })
  }

  private requireResync() {
    this.releaseAggregateBytes(this.pendingBytes)
    this.pending.length = 0
    this.pendingEventCount = 0
    this.pendingBytes = 0
    this.terminal = {
      status: 'resync-required',
      reason: 'slow-consumer',
      cursor: this.currentCursor(),
    }
    this.onClose()
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter(this.terminal)
    }
  }

  next(): Promise<SessionHostEventDelivery> {
    const pending = this.pending.shift()
    if (pending) {
      if (pending.status === 'cursor-advanced') return Promise.resolve(pending)
      this.pendingEventCount -= 1
      this.pendingBytes -= pending.bytes
      this.releaseAggregateBytes(pending.bytes)
      return Promise.resolve({ status: 'event', event: pending.event })
    }
    if (this.terminal) return Promise.resolve(this.terminal)
    if (this.waiter) throw new Error('Only one pending Session Host subscription read is allowed.')
    return new Promise((resolve) => {
      this.waiter = resolve
    })
  }

  close(): void {
    if (this.terminal) return
    this.releaseAggregateBytes(this.pendingBytes)
    this.pending.length = 0
    this.pendingEventCount = 0
    this.pendingBytes = 0
    this.terminal = { status: 'closed' }
    this.onClose()
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter(this.terminal)
    }
  }
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
  private readonly replayWindow: SessionHostEventEnvelope[] = []
  private replayBytes = 0
  private retainedSubscriberBytes = 0
  private readonly subscribers = new Set<SessionHostEventSubscription>()

  constructor(options: SessionHostEventHubOptions = {}) {
    this.hostInstanceId = options.hostInstanceId ?? randomUUID()
    this.replayCapacity = options.replayCapacity ?? DEFAULT_REPLAY_CAPACITY
    this.subscriberCapacity = options.subscriberCapacity ?? DEFAULT_SUBSCRIBER_CAPACITY
    this.replayByteCapacity = options.replayByteCapacity ?? DEFAULT_REPLAY_BYTE_CAPACITY
    this.subscriberByteCapacity = options.subscriberByteCapacity ?? DEFAULT_SUBSCRIBER_BYTE_CAPACITY
    this.subscriberAggregateByteCapacity =
      options.subscriberAggregateByteCapacity ?? DEFAULT_SUBSCRIBER_AGGREGATE_BYTE_CAPACITY
    this.now = options.now ?? Date.now
    this.assertPositiveCapacity(this.replayCapacity, 'replay')
    this.assertPositiveCapacity(this.subscriberCapacity, 'subscriber')
    this.assertPositiveCapacity(this.replayByteCapacity, 'replay bytes')
    this.assertPositiveCapacity(this.subscriberByteCapacity, 'subscriber bytes')
    this.assertPositiveCapacity(this.subscriberAggregateByteCapacity, 'aggregate subscriber bytes')
  }

  private assertPositiveCapacity(capacity: number, name: string) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error(`Session Host event ${name} capacity must be a positive safe integer.`)
    }
  }

  cursor(): SessionHostEventCursor {
    return { hostInstanceId: this.hostInstanceId, sequence: this.sequence }
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
      this.replayWindow.push(event)
      this.replayBytes += bytes
      while (
        this.replayWindow.length > this.replayCapacity ||
        this.replayBytes > this.replayByteCapacity
      ) {
        const removed = this.replayWindow.shift()
        if (removed) this.replayBytes -= Buffer.byteLength(JSON.stringify(removed), 'utf8')
      }
    } else {
      this.replayWindow.length = 0
      this.replayBytes = 0
    }
    for (const subscriber of this.subscribers) subscriber.enqueue(event, bytes)
    return event
  }

  replayAfter(cursor: SessionHostEventCursor): SessionHostEventReplayResult {
    const current = this.cursor()
    if (cursor.hostInstanceId !== this.hostInstanceId) {
      return { status: 'resync-required', reason: 'host-restarted', cursor: current }
    }
    if (cursor.sequence > this.sequence) {
      return { status: 'resync-required', reason: 'cursor-ahead', cursor: current }
    }
    const oldestSequence = this.replayWindow[0]?.cursor.sequence ?? this.sequence + 1
    if (cursor.sequence < oldestSequence - 1) {
      return { status: 'resync-required', reason: 'cursor-expired', cursor: current }
    }
    return {
      status: 'ready',
      events: this.replayWindow.filter((event) => event.cursor.sequence > cursor.sequence),
      cursor: current,
    }
  }

  subscribeAfter(
    cursor: SessionHostEventCursor = this.cursor(),
    accepts: (event: SessionHostEventEnvelope) => boolean = () => true,
    options: { readonly advanceFilteredCursor?: boolean } = {},
  ): SessionHostSubscriptionResult {
    const replay = this.replayAfter(cursor)
    if (replay.status === 'resync-required') return replay
    const visibleReplay = replay.events.filter(accepts)
    const replayBytes = visibleReplay.reduce(
      (total, event) => total + Buffer.byteLength(JSON.stringify(event), 'utf8'),
      0,
    )
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
      () => this.subscribers.delete(subscription),
      accepts,
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
    for (const event of replay.events) {
      subscription.enqueue(event, Buffer.byteLength(JSON.stringify(event), 'utf8'))
    }
    this.subscribers.add(subscription)
    return { status: 'ready', subscription }
  }

  close(): void {
    for (const subscription of [...this.subscribers]) subscription.close()
  }
}
