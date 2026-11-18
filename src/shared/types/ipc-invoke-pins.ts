/**
 * Pinned session IPC channels (issue #97).
 *
 * Kept in their own map rather than appended to the core or integration maps: both
 * were within a couple of lines of the 300-line limit, and pins are a self-contained
 * surface — list in Manual order, pin, unpin, move between neighbours.
 */
import type { SessionId } from './brand'
import type { PinnedSession, PinnedSessionMove } from './session'

export interface IpcPinnedSessionInvokeChannelMap {
  /** Every Pinned session in Manual order, archived ones included. */
  'sessions:pins:list': {
    args: []
    return: PinnedSession[]
  }
  'sessions:pins:pin': {
    args: [id: SessionId]
    return: undefined
  }
  'sessions:pins:unpin': {
    args: [id: SessionId]
    return: undefined
  }
  /** Reposition one pin between the neighbours it should land between. */
  'sessions:pins:move': {
    args: [move: PinnedSessionMove]
    return: undefined
  }
}
