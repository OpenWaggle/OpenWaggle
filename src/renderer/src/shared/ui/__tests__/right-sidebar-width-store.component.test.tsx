import { beforeEach, describe, expect, it } from 'vitest'
import { RIGHT_PANEL_WIDTH_STORAGE_KEY } from '../right-sidebar-sizing-presets'
import { initialStoredWidth, useSidebarWidthStore } from '../right-sidebar-width-store'

const FALLBACK = 560

describe('shared right sidebar width', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useSidebarWidthStore.setState({ widths: {} })
  })

  it('adopts the widest pre-ADR-0043 width once for the shared Right panel key', () => {
    window.localStorage.setItem('openwaggle:diff-sidebar-width', '640')
    window.localStorage.setItem('openwaggle:workspace-side-panel-width', '700')
    expect(initialStoredWidth(RIGHT_PANEL_WIDTH_STORAGE_KEY, FALLBACK)).toBe(700)

    window.localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, '480')
    expect(initialStoredWidth(RIGHT_PANEL_WIDTH_STORAGE_KEY, FALLBACK)).toBe(480)
  })

  it('never borrows legacy widths for other keys', () => {
    window.localStorage.setItem('openwaggle:diff-sidebar-width', '640')
    expect(initialStoredWidth('openwaggle:other', FALLBACK)).toBe(FALLBACK)
  })

  it('shares and persists a committed width', () => {
    useSidebarWidthStore.getState().setWidth(RIGHT_PANEL_WIDTH_STORAGE_KEY, 610)
    expect(useSidebarWidthStore.getState().widths[RIGHT_PANEL_WIDTH_STORAGE_KEY]).toBe(610)
    expect(window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY)).toBe('610')
  })
})
