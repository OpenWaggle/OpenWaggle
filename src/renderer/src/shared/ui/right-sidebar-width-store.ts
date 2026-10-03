import { create } from 'zustand'
import { persistWidth, readStoredWidth } from './right-sidebar-layout-sizing'
import {
  LEGACY_RIGHT_PANEL_WIDTH_STORAGE_KEYS,
  RIGHT_PANEL_WIDTH_STORAGE_KEY,
} from './right-sidebar-sizing-presets'

interface SidebarWidthState {
  readonly widths: Readonly<Record<string, number>>
  readonly setWidth: (storageKey: string, width: number) => void
}

/**
 * Live widths shared by every RightSidebarLayout using the same storage key, so nested right
 * sidebars resize together instead of each keeping its own copy (ADR 0043).
 */
export const useSidebarWidthStore = create<SidebarWidthState>((set) => ({
  widths: {},
  setWidth: (storageKey, width) => {
    persistWidth(storageKey, width)
    set((state) => ({ widths: { ...state.widths, [storageKey]: width } }))
  },
}))

const MISSING_WIDTH = Number.NaN

/** Reads a saved width, adopting the widest pre-ADR-0043 width for the shared Right panel key. */
export function initialStoredWidth(storageKey: string, fallbackWidth: number) {
  const saved = readStoredWidth(storageKey, MISSING_WIDTH)
  if (Number.isFinite(saved)) return saved
  if (storageKey !== RIGHT_PANEL_WIDTH_STORAGE_KEY) return fallbackWidth
  const legacy = LEGACY_RIGHT_PANEL_WIDTH_STORAGE_KEYS.map((key) =>
    readStoredWidth(key, MISSING_WIDTH),
  ).filter((width) => Number.isFinite(width))
  return legacy.length > 0 ? Math.max(...legacy) : fallbackWidth
}
