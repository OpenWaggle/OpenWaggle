import type { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { WebContents } from 'electron'
import { getAllBrowserWindows } from '../desktop-ui'
import { AgentEventDelivery, type AgentEventTarget } from './agent-event-delivery'

const agentEvents = new AgentEventDelivery()
const trackedContents = new WeakSet<WebContents>()

function liveWindows() {
  return getAllBrowserWindows().filter((win) => !win.isDestroyed())
}

function agentEventTargets(): AgentEventTarget[] {
  return liveWindows().map((win) => {
    const { webContents } = win
    return {
      id: webContents.id,
      send: (payload) => {
        if (!win.isDestroyed()) webContents.send('agent:event', payload)
      },
    }
  })
}

/**
 * Forward a message to all non-destroyed renderer windows. Streamed deltas still on their way
 * (`broadcastAgentEvent`) are sent first, so no window sees a message ahead of an earlier delta.
 */
export function broadcastToWindows(channel: string, ...args: unknown[]): void {
  try {
    agentEvents.flushAll(agentEventTargets())
    for (const win of liveWindows()) {
      win.webContents.send(channel, ...args)
    }
  } catch {
    // Electron windows may not be available in test environments
  }
}

/** Sends an `agent:event` to every window, coalescing streamed deltas (D8). */
export function broadcastAgentEvent(payload: {
  readonly sessionId: SessionId
  readonly event: AgentTransportEvent
}): void {
  try {
    agentEvents.deliver(agentEventTargets(), payload.sessionId, payload.event)
  } catch {
    // Electron windows may not be available in test environments
  }
}

/**
 * Reads a Session's stream buffer for a window, after sending every window that Session's pending
 * deltas. The buffer already holds the pending text, so the delta must reach the window before the
 * snapshot does, or the window appends that text a second time.
 */
export function readAfterFlushingSession<T>(sessionId: SessionId, read: () => T): T {
  let targets: AgentEventTarget[] = []
  try {
    targets = agentEventTargets()
  } catch {
    // Electron windows may not be available in test environments
  }
  return agentEvents.readFlushed(targets, sessionId, read)
}

/** The Sessions a window shows, whose deltas it gets about 30 times a second. */
export function setWindowShownSessions(webContents: WebContents, sessionIds: readonly SessionId[]) {
  agentEvents.setShownSessions(webContents.id, sessionIds)
  if (trackedContents.has(webContents)) return
  trackedContents.add(webContents)
  const id = webContents.id
  webContents.once('destroyed', () => agentEvents.forgetTarget(id))
}
