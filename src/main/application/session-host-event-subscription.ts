import type {
  SessionHostEventCursor,
  SessionHostEventDelivery,
  SessionHostEventEnvelope,
} from '@shared/types/session-host-event'

export class SessionHostEventSubscription {
  private readonly pending: (
    | { readonly status: 'event'; readonly event: SessionHostEventEnvelope; readonly bytes: number }
    | { readonly status: 'cursor-advanced'; readonly cursor: SessionHostEventCursor }
  )[] = []
  private pendingEventCount = 0
  private pendingBytes = 0
  private waiter: ((delivery: SessionHostEventDelivery) => void) | null = null
  private terminal: SessionHostEventDelivery | null = null
  private readonly capacity: number
  private readonly byteCapacity: number
  private readonly currentCursor: () => SessionHostEventCursor
  private readonly onClose: () => void
  private readonly accepts: (event: SessionHostEventEnvelope) => boolean
  private readonly advanceFilteredCursor: (event: SessionHostEventEnvelope) => boolean
  private readonly reserveAggregateBytes: (bytes: number) => boolean
  private readonly releaseAggregateBytes: (bytes: number) => void

  constructor(
    capacity: number,
    byteCapacity: number,
    currentCursor: () => SessionHostEventCursor,
    onClose: () => void,
    accepts: (event: SessionHostEventEnvelope) => boolean,
    advanceFilteredCursor: (event: SessionHostEventEnvelope) => boolean,
    reserveAggregateBytes: (bytes: number) => boolean,
    releaseAggregateBytes: (bytes: number) => void,
  ) {
    this.capacity = capacity
    this.byteCapacity = byteCapacity
    this.currentCursor = currentCursor
    this.onClose = onClose
    this.accepts = accepts
    this.advanceFilteredCursor = advanceFilteredCursor
    this.reserveAggregateBytes = reserveAggregateBytes
    this.releaseAggregateBytes = releaseAggregateBytes
  }

  enqueue(event: SessionHostEventEnvelope, bytes: number) {
    if (this.terminal) return
    if (!this.accepts(event)) {
      if (this.advanceFilteredCursor(event)) this.enqueueCursorAdvance(event.cursor)
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

  private enqueueCursorAdvance(cursor: SessionHostEventCursor) {
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

  requireResync(
    reason: Extract<
      SessionHostEventDelivery,
      { readonly status: 'resync-required' }
    >['reason'] = 'slow-consumer',
  ) {
    if (this.terminal) return
    this.releaseAggregateBytes(this.pendingBytes)
    this.pending.length = 0
    this.pendingEventCount = 0
    this.pendingBytes = 0
    this.terminal = {
      status: 'resync-required',
      reason,
      cursor: this.currentCursor(),
    }
    this.onClose()
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = null
      waiter(this.terminal)
    }
  }

  next() {
    const pending = this.pending.shift()
    if (pending) {
      if (pending.status === 'cursor-advanced') {
        const promise: Promise<SessionHostEventDelivery> = Promise.resolve(pending)
        return promise
      }
      this.pendingEventCount -= 1
      this.pendingBytes -= pending.bytes
      this.releaseAggregateBytes(pending.bytes)
      const promise: Promise<SessionHostEventDelivery> = Promise.resolve({
        status: 'event',
        event: pending.event,
      })
      return promise
    }
    if (this.terminal) {
      const promise: Promise<SessionHostEventDelivery> = Promise.resolve(this.terminal)
      return promise
    }
    if (this.waiter) throw new Error('Only one pending Session Host subscription read is allowed.')
    const promise: Promise<SessionHostEventDelivery> = new Promise<SessionHostEventDelivery>(
      (resolve) => {
        this.waiter = resolve
      },
    )
    return promise
  }

  /**
   * Drops every queued delivery but keeps a terminal one. For a consumer that re-reads canonical
   * state on any delivery, the events queued behind the one it is handling only ask for the same
   * read again; dropping them keeps a burst from filling the queue and forcing a resync.
   */
  discardPending() {
    this.releaseAggregateBytes(this.pendingBytes)
    this.pending.length = 0
    this.pendingEventCount = 0
    this.pendingBytes = 0
  }

  close() {
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
