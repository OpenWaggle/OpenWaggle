import { create } from 'zustand'

/** The open Right panel's maximize state, published by the shell (ADR 0043). */
export interface RightPanelMaximizeTarget {
  readonly maximized: boolean
  readonly toggle: () => void
  /** The current `rightPanel.toggleMaximized` binding, shown in the tooltip. */
  readonly shortcutLabel: string | null
}

interface RightPanelMaximizeState {
  readonly target: RightPanelMaximizeTarget | null
  readonly publish: (target: RightPanelMaximizeTarget | null) => void
}

/**
 * Every Right panel surface shares one container, so every surface header offers the same
 * maximize control. Features read it here without importing shell internals.
 */
export const useRightPanelMaximizeStore = create<RightPanelMaximizeState>()((set) => ({
  target: null,
  publish: (target) => set({ target }),
}))
