import { safeDecodeUnknown } from '@shared/schema'
import {
  mcpAppFrameRegisterInputSchema,
  mcpAppFrameUnregisterInputSchema,
} from '@shared/schemas/mcp-app-frame'
import * as Effect from 'effect/Effect'
import type {
  Event,
  Session,
  WebContents,
  WebContentsDidStartNavigationEventParams,
} from 'electron'
import { shouldPurgeVisualizationFramesForNavigation } from '../inline-visualization-owner-lifecycle'
import {
  registerMcpAppFrame,
  unregisterMcpAppFrame,
  unregisterMcpAppFramesForOwner,
} from '../mcp-app-frame-protocol'
import { typedHandle } from './typed-ipc'

const monitoredOwners = new Set<number>()

/**
 * Each frame has its own origin, so what an App stored (cookies, IndexedDB, local storage) is
 * its frame's alone; it is cleared when the frame goes, so nothing persists between frames.
 */
function clearFrameStorage(session: Session, origins: readonly string[]) {
  for (const origin of origins) void session.clearStorageData({ origin }).catch(() => undefined)
}

/** A renderer's App documents are dropped when it navigates away, crashes, or closes. */
function monitorOwner(sender: WebContents) {
  if (monitoredOwners.has(sender.id)) return
  monitoredOwners.add(sender.id)
  const ownerId = sender.id
  const { session } = sender
  const purge = () => clearFrameStorage(session, unregisterMcpAppFramesForOwner(ownerId))
  const onNavigation = (details: Event<WebContentsDidStartNavigationEventParams>) => {
    if (shouldPurgeVisualizationFramesForNavigation(details)) purge()
  }
  const stop = () => {
    purge()
    sender.removeListener('did-start-navigation', onNavigation)
    sender.removeListener('render-process-gone', stop)
    sender.removeListener('destroyed', stop)
    monitoredOwners.delete(ownerId)
  }
  sender.on('did-start-navigation', onNavigation)
  sender.once('render-process-gone', stop)
  sender.once('destroyed', stop)
}

export function registerMcpAppFrameHandlers() {
  typedHandle('mcp:register-app-frame', (event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = safeDecodeUnknown(mcpAppFrameRegisterInputSchema, input)
      if (!decoded.success) return yield* Effect.fail(new Error(decoded.issues.join('; ')))
      monitorOwner(event.sender)
      return registerMcpAppFrame(decoded.data, event.sender.id)
    }),
  )
  typedHandle('mcp:unregister-app-frame', (event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = safeDecodeUnknown(mcpAppFrameUnregisterInputSchema, input)
      if (!decoded.success) return yield* Effect.fail(new Error(decoded.issues.join('; ')))
      clearFrameStorage(event.sender.session, unregisterMcpAppFrame(decoded.data, event.sender.id))
    }),
  )
}
