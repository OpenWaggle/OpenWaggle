import type { TerminalKey } from '@shared/types/terminal'

interface AttachmentState {
  readonly surfaces: ReadonlySet<number>
}

export interface TerminalAttachmentTracker {
  readonly attach: (key: TerminalKey, surfaceId: number) => void
  readonly detach: (key: TerminalKey, surfaceId: number, orphaned: boolean) => void
  readonly detachSurface: (surfaceId: number, orphanedKeys: readonly TerminalKey[]) => void
  readonly move: (fromKey: TerminalKey, toKey: TerminalKey) => void
  readonly capture: (key: TerminalKey) => AttachmentState | undefined
  readonly orphanIfUnchanged: (key: TerminalKey, captured: AttachmentState | undefined) => boolean
  readonly isAttached: (key: TerminalKey) => boolean
  readonly forget: (key: TerminalKey) => void
  readonly clear: () => void
}

export function makeTerminalAttachmentTracker(): TerminalAttachmentTracker {
  const attached = new Map<TerminalKey, AttachmentState>()

  const replace = (key: TerminalKey, surfaces: ReadonlySet<number>) => {
    if (surfaces.size === 0) attached.delete(key)
    else attached.set(key, { surfaces })
  }

  return {
    attach: (key, surfaceId) => {
      const surfaces = new Set(attached.get(key)?.surfaces)
      surfaces.add(surfaceId)
      replace(key, surfaces)
    },
    detach: (key, surfaceId, orphaned) => {
      if (orphaned) {
        attached.delete(key)
        return
      }
      const surfaces = new Set(attached.get(key)?.surfaces)
      surfaces.delete(surfaceId)
      replace(key, surfaces)
    },
    detachSurface: (surfaceId, orphanedKeys) => {
      for (const [key, state] of attached) {
        const surfaces = new Set(state.surfaces)
        surfaces.delete(surfaceId)
        replace(key, surfaces)
      }
      for (const key of orphanedKeys) attached.delete(key)
    },
    move: (fromKey, toKey) => {
      if (fromKey === toKey) return
      const source = attached.get(fromKey)
      if (source === undefined) return
      const surfaces = new Set(attached.get(toKey)?.surfaces)
      for (const surfaceId of source.surfaces) surfaces.add(surfaceId)
      attached.delete(fromKey)
      replace(toKey, surfaces)
    },
    capture: (key) => attached.get(key),
    orphanIfUnchanged: (key, captured) => {
      if (attached.get(key) !== captured) return false
      attached.delete(key)
      return true
    },
    isAttached: (key) => attached.has(key),
    forget: (key) => attached.delete(key),
    clear: () => attached.clear(),
  }
}
