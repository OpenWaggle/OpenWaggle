import { create } from 'zustand'

export interface BrowserPreviewFloatingPosition {
  readonly x: number
  readonly y: number
}

export interface BrowserPreviewFloatingSize {
  readonly width: number
  readonly height: number
}

export interface BrowserPreviewFloatingState {
  readonly previewId: string
  readonly position: BrowserPreviewFloatingPosition | null
  readonly size: BrowserPreviewFloatingSize | null
  readonly sourceViewport?: BrowserPreviewFloatingSize
}

interface BrowserPreviewFloatingStoreState {
  readonly byOwnerKey: Record<string, BrowserPreviewFloatingState>
  readonly open: (
    ownerKey: string,
    previewId: string,
    sourceViewport?: BrowserPreviewFloatingSize,
  ) => void
  readonly close: (ownerKey: string, previewId?: string) => void
  readonly move: (
    ownerKey: string,
    previewId: string,
    position: BrowserPreviewFloatingPosition,
  ) => void
  readonly resize: (ownerKey: string, previewId: string, size: BrowserPreviewFloatingSize) => void
  readonly migrateOwner: (fromOwnerKey: string, toOwnerKey: string) => void
  readonly removeOwner: (ownerKey: string) => void
  readonly removePreview: (ownerKey: string, previewId: string) => void
}

function withoutOwner(byOwnerKey: Record<string, BrowserPreviewFloatingState>, ownerKey: string) {
  const next = { ...byOwnerKey }
  delete next[ownerKey]
  return next
}

export const useBrowserPreviewFloatingStore = create<BrowserPreviewFloatingStoreState>()((set) => ({
  byOwnerKey: {},
  open: (ownerKey, previewId, sourceViewport) =>
    set((state) => {
      if (ownerKey.length === 0 || previewId.length === 0) return state
      const current = state.byOwnerKey[ownerKey]
      if (current?.previewId === previewId) return state
      return {
        byOwnerKey: {
          ...state.byOwnerKey,
          [ownerKey]: {
            previewId,
            position: current?.position ?? null,
            size: current?.size ?? null,
            ...(sourceViewport === undefined ? {} : { sourceViewport }),
          },
        },
      }
    }),
  close: (ownerKey, previewId) =>
    set((state) => {
      const current = state.byOwnerKey[ownerKey]
      if (current === undefined || (previewId !== undefined && current.previewId !== previewId)) {
        return state
      }
      return { byOwnerKey: withoutOwner(state.byOwnerKey, ownerKey) }
    }),
  move: (ownerKey, previewId, position) =>
    set((state) => {
      const current = state.byOwnerKey[ownerKey]
      if (current?.previewId !== previewId) return state
      if (current.position?.x === position.x && current.position.y === position.y) return state
      return {
        byOwnerKey: {
          ...state.byOwnerKey,
          [ownerKey]: { ...current, position },
        },
      }
    }),
  resize: (ownerKey, previewId, size) =>
    set((state) => {
      const current = state.byOwnerKey[ownerKey]
      if (current?.previewId !== previewId) return state
      if (current.size?.width === size.width && current.size.height === size.height) return state
      return {
        byOwnerKey: {
          ...state.byOwnerKey,
          [ownerKey]: { ...current, size },
        },
      }
    }),
  migrateOwner: (fromOwnerKey, toOwnerKey) =>
    set((state) => {
      if (fromOwnerKey === toOwnerKey || toOwnerKey.length === 0) return state
      const current = state.byOwnerKey[fromOwnerKey]
      if (current === undefined) return state
      return {
        byOwnerKey: {
          ...withoutOwner(state.byOwnerKey, fromOwnerKey),
          [toOwnerKey]: current,
        },
      }
    }),
  removeOwner: (ownerKey) =>
    set((state) =>
      state.byOwnerKey[ownerKey] === undefined
        ? state
        : { byOwnerKey: withoutOwner(state.byOwnerKey, ownerKey) },
    ),
  removePreview: (ownerKey, previewId) =>
    set((state) => {
      if (state.byOwnerKey[ownerKey]?.previewId !== previewId) return state
      return { byOwnerKey: withoutOwner(state.byOwnerKey, ownerKey) }
    }),
}))

export function selectBrowserPreviewFloating(
  byOwnerKey: Record<string, BrowserPreviewFloatingState>,
  ownerKey: string | null | undefined,
) {
  if (!ownerKey) return null
  return byOwnerKey[ownerKey] ?? null
}
