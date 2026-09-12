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
