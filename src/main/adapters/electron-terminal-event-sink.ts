import type { TerminalEventPayload, TerminalKey } from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { webContents } from 'electron'
import { TerminalEventSink } from '../ports/terminal-event-sink'

/**
 * Electron implementation of the terminal event sink: runtime events reach
 * only the WebContents attached to that terminal, never a broadcast to every
 * window (ADR 0030). Attachments whose WebContents died (window closed or
 * reloaded) are pruned lazily on the next emit.
 */
export const ElectronTerminalEventSinkLive = Layer.effect(
  TerminalEventSink,
  Effect.sync(() => {
    const attached = new Map<TerminalKey, Set<number>>()

    const send = (surfaceId: number, payload: TerminalEventPayload): boolean => {
      try {
        const target = webContents.fromId(surfaceId)
        if (target === undefined || target.isDestroyed()) return false
        target.send('terminal:event', payload)
        return true
      } catch {
        return false
      }
    }

    return {
      emit: (payload) =>
        Effect.sync(() => {
          const key = terminalKeyOf(payload.ownerKey, payload.terminalId)
          const surfaces = attached.get(key)
          if (surfaces === undefined) return 0
          let delivered = 0
          for (const surfaceId of surfaces) {
            if (send(surfaceId, payload)) delivered += 1
            else surfaces.delete(surfaceId)
          }
          if (surfaces.size === 0) attached.delete(key)
          return delivered
        }),
      attach: (terminalKey, surfaceId) =>
        Effect.sync(() => {
          const surfaces = attached.get(terminalKey) ?? new Set<number>()
          surfaces.add(surfaceId)
          attached.set(terminalKey, surfaces)
        }),
      detach: (terminalKey, surfaceId) =>
        Effect.sync(() => {
          const surfaces = attached.get(terminalKey)
          if (surfaces === undefined) return true
          surfaces.delete(surfaceId)
          if (surfaces.size > 0) return false
          attached.delete(terminalKey)
          return true
        }),
      move: (fromKey, toKey) =>
        Effect.sync(() => {
          if (fromKey === toKey) return
          const source = attached.get(fromKey)
          if (source === undefined) return
          const destination = attached.get(toKey) ?? new Set<number>()
          for (const surfaceId of source) destination.add(surfaceId)
          attached.set(toKey, destination)
          attached.delete(fromKey)
        }),
      detachSurface: (surfaceId) =>
        Effect.sync(() => {
          const orphaned: TerminalKey[] = []
          for (const [key, surfaces] of attached) {
            surfaces.delete(surfaceId)
            if (surfaces.size > 0) continue
            attached.delete(key)
            orphaned.push(key)
          }
          return orphaned
        }),
    }
  }),
)
