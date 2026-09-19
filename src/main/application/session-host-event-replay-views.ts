import { randomUUID } from 'node:crypto'
import type {
  SessionHostEventCursor,
  SessionHostEventEnvelope,
} from '@shared/types/session-host-event'
import {
  type RetainedReplayResult,
  SessionHostEventReplayWindow,
} from './session-host-event-replay-window'
import type { SessionHostEventSubscription } from './session-host-event-subscription'

export interface SessionHostEventReplayViewUsage {
  readonly entries: number
  readonly bytes: number
}

/** A bounded replay lane containing only events admitted by one restricted authority snapshot. */
export class SessionHostEventReplayView {
  readonly #replayWindow: SessionHostEventReplayWindow
  readonly #subscriptions = new Set<SessionHostEventSubscription>()
  #hostInstanceId: string
  #minimumCursorSequence: number
  #closed = false

  constructor(
    hostInstanceId: string,
    baselineSequence: number,
    replayCapacity: number,
    private readonly replayByteCapacity: number,
    private readonly accepts: (event: SessionHostEventEnvelope) => boolean,
    private readonly onClose: () => void,
  ) {
    this.#hostInstanceId = hostInstanceId
    this.#minimumCursorSequence = baselineSequence
    this.#replayWindow = new SessionHostEventReplayWindow(replayCapacity, replayByteCapacity)
  }

  get hostInstanceId() {
    return this.#hostInstanceId
  }

  acceptsEvent(event: SessionHostEventEnvelope) {
    return !this.#closed && this.accepts(event)
  }

  record(event: SessionHostEventEnvelope, bytes: number) {
    if (!this.acceptsEvent(event)) return
    if (bytes > this.replayByteCapacity) {
      this.#replayWindow.clear()
      this.#minimumCursorSequence = event.cursor.sequence
      return
    }
    const evicted = this.#replayWindow.push({ event, bytes })
    if (evicted) this.#minimumCursorSequence = evicted.event.cursor.sequence
  }

  retainedReplayAfter(
    cursor: SessionHostEventCursor,
    current: SessionHostEventCursor,
  ): RetainedReplayResult {
    if (this.#closed || cursor.sequence < this.#minimumCursorSequence) {
      return { status: 'resync-required', reason: 'cursor-expired', cursor: current }
    }
    if (cursor.sequence > current.sequence) {
      return { status: 'resync-required', reason: 'cursor-ahead', cursor: current }
    }
    return {
      status: 'ready',
      entries: this.#replayWindow.after(cursor.sequence),
      cursor: current,
    }
  }

  usage(): SessionHostEventReplayViewUsage {
    return this.#replayWindow.usage()
  }

  attach(subscription: SessionHostEventSubscription) {
    if (this.#closed) {
      subscription.requireResync('cursor-expired')
      return
    }
    this.#subscriptions.add(subscription)
  }

  detach(subscription: SessionHostEventSubscription) {
    this.#subscriptions.delete(subscription)
  }

  rotateHostInstanceId(hostInstanceId: string) {
    if (this.#closed) return false
    this.#hostInstanceId = hostInstanceId
    for (const subscription of [...this.#subscriptions]) {
      subscription.requireResync('cursor-expired')
    }
    return true
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.#replayWindow.clear()
    for (const subscription of [...this.#subscriptions]) {
      subscription.requireResync('cursor-expired')
    }
    this.onClose()
  }
}

export class SessionHostEventReplayViews {
  readonly #views = new Map<string, SessionHostEventReplayView>()
  readonly #hostPrefix: string

  constructor(hostInstanceId: string) {
    this.#hostPrefix = `${hostInstanceId}\0restricted-replay:`
  }

  create(
    baselineSequence: number,
    accepts: (event: SessionHostEventEnvelope) => boolean,
    limits: { readonly capacity: number; readonly byteCapacity: number },
  ) {
    const hostInstanceId = this.#nextHostInstanceId()
    const view = new SessionHostEventReplayView(
      hostInstanceId,
      baselineSequence,
      limits.capacity,
      limits.byteCapacity,
      accepts,
      () => this.#views.delete(view.hostInstanceId),
    )
    this.#views.set(hostInstanceId, view)
    return view
  }

  rotate(view: SessionHostEventReplayView) {
    if (this.#views.get(view.hostInstanceId) !== view) return false
    this.#views.delete(view.hostInstanceId)
    if (!view.rotateHostInstanceId(this.#nextHostInstanceId())) return false
    this.#views.set(view.hostInstanceId, view)
    return true
  }

  viewFor(cursor: SessionHostEventCursor) {
    return this.#views.get(cursor.hostInstanceId)
  }

  retainedReplayAfter(cursor: SessionHostEventCursor, current: SessionHostEventCursor) {
    const view = this.viewFor(cursor)
    if (view) return view.retainedReplayAfter(cursor, current)
    if (cursor.hostInstanceId.startsWith(this.#hostPrefix)) {
      return { status: 'resync-required', reason: 'cursor-expired', cursor: current } as const
    }
  }

  record(event: SessionHostEventEnvelope, bytes: number) {
    for (const view of this.#views.values()) view.record(event, bytes)
  }

  close() {
    for (const view of [...this.#views.values()]) view.close()
  }

  #nextHostInstanceId() {
    return `${this.#hostPrefix}${randomUUID()}`
  }
}
