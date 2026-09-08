import type {
  SessionHostEventCursor,
  SessionHostEventEnvelope,
  SessionHostEventReplayResult,
} from '@shared/types/session-host-event'

export interface RetainedSessionHostEvent {
  readonly event: SessionHostEventEnvelope
  readonly bytes: number
}

export type RetainedReplayResult =
  | {
      readonly status: 'ready'
      readonly entries: readonly RetainedSessionHostEvent[]
      readonly cursor: SessionHostEventCursor
    }
  | Extract<SessionHostEventReplayResult, { readonly status: 'resync-required' }>

export class SessionHostEventReplayWindow {
  readonly #entries = new Map<number, RetainedSessionHostEvent>()
  #head = 0
  #size = 0
  #bytes = 0

  constructor(
    private readonly capacity: number,
    private readonly byteCapacity: number,
  ) {}

  first() {
    return this.#size === 0 ? undefined : this.#entries.get(this.#head)
  }

  usage() {
    return { entries: this.#size, bytes: this.#bytes }
  }

  clear() {
    this.#entries.clear()
    this.#head = 0
    this.#size = 0
    this.#bytes = 0
  }

  push(entry: RetainedSessionHostEvent) {
    let lastEvicted: RetainedSessionHostEvent | undefined
    if (this.#size === this.capacity) lastEvicted = this.#evictOldest()
    const index = (this.#head + this.#size) % this.capacity
    this.#entries.set(index, entry)
    this.#size += 1
    this.#bytes += entry.bytes
    while (this.#bytes > this.byteCapacity) {
      lastEvicted = this.#evictOldest() ?? lastEvicted
    }
    return lastEvicted
  }

  after(sequence: number) {
    const retained: RetainedSessionHostEvent[] = []
    for (let offset = 0; offset < this.#size; offset += 1) {
      const entry = this.#entries.get((this.#head + offset) % this.capacity)
      if (entry && entry.event.cursor.sequence > sequence) retained.push(entry)
    }
    return retained
  }

  #evictOldest() {
    if (this.#size === 0) return
    const entry = this.#entries.get(this.#head)
    this.#entries.delete(this.#head)
    this.#head = (this.#head + 1) % this.capacity
    this.#size -= 1
    if (entry) this.#bytes = Math.max(0, this.#bytes - entry.bytes)
    return entry
  }
}
