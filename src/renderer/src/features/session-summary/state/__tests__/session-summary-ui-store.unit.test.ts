// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isSessionSummaryPanelVisible, useSessionSummaryUIStore } from '../session-summary-ui-store'

const WIDE_CONTEXT = {
  available: true,
  autoHidden: false,
  rightSidebarOpen: false,
} as const

describe('session-summary-ui-store', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionSummaryUIStore.setState({ panels: {} })
  })

  afterEach(() => vi.restoreAllMocks())

  it('persists visibility independently for each session', () => {
    const store = useSessionSummaryUIStore.getState()
    store.syncPanel('session-a', WIDE_CONTEXT)
    store.syncPanel('session-b', WIDE_CONTEXT)

    useSessionSummaryUIStore.getState().closePanel('session-a')

    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-a']),
    ).toBe(false)
    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-b']),
    ).toBe(true)
    expect(localStorage.getItem('openwaggle:session-summary:session-a:panel')).toBe('false')
  })

  it('lets a header toggle force the floating panel open without enough automatic space', () => {
    useSessionSummaryUIStore.getState().syncPanel('session-a', {
      ...WIDE_CONTEXT,
      autoHidden: true,
    })
    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-a']),
    ).toBe(false)

    useSessionSummaryUIStore.getState().togglePanel('session-a')

    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-a']),
    ).toBe(true)
  })

  it('hides while a right sidebar is open and restores the same session afterward', () => {
    const store = useSessionSummaryUIStore.getState()
    store.syncPanel('session-a', WIDE_CONTEXT)
    store.syncPanel('session-a', {
      ...WIDE_CONTEXT,
      autoHidden: true,
      rightSidebarOpen: true,
    })
    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-a']),
    ).toBe(false)

    store.syncPanel('session-a', WIDE_CONTEXT)
    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-a']),
    ).toBe(true)
  })

  it('keeps a manual narrow-width override through a wide and narrow round trip', () => {
    const store = useSessionSummaryUIStore.getState()
    store.syncPanel('session-a', { ...WIDE_CONTEXT, autoHidden: true })
    store.togglePanel('session-a')
    store.syncPanel('session-a', WIDE_CONTEXT)
    store.syncPanel('session-a', { ...WIDE_CONTEXT, autoHidden: true })

    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-a']),
    ).toBe(true)
  })

  it('toggles deferred user intent while a right sidebar suppresses visibility', () => {
    const store = useSessionSummaryUIStore.getState()
    store.syncPanel('session-a', { ...WIDE_CONTEXT, rightSidebarOpen: true })

    store.togglePanel('session-a')
    expect(useSessionSummaryUIStore.getState().panels['session-a']?.expanded).toBe(false)
    store.togglePanel('session-a')
    expect(useSessionSummaryUIStore.getState().panels['session-a']?.expanded).toBe(true)
    expect(useSessionSummaryUIStore.getState().panels['session-a']?.forcedOpen).toBe(false)
    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-a']),
    ).toBe(false)
  })

  it('restores a narrow-width open request after sidebar suppression ends', () => {
    const store = useSessionSummaryUIStore.getState()
    const narrowContext = { ...WIDE_CONTEXT, autoHidden: true }
    store.syncPanel('session-a', narrowContext)
    store.closePanel('session-a')
    store.syncPanel('session-a', { ...narrowContext, rightSidebarOpen: true })

    store.togglePanel('session-a')

    expect(useSessionSummaryUIStore.getState().panels['session-a']).toMatchObject({
      expanded: true,
      forcedOpen: true,
    })
    store.syncPanel('session-a', narrowContext)
    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-a']),
    ).toBe(true)
  })

  it('keeps controls usable when localStorage access fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    const store = useSessionSummaryUIStore.getState()
    store.syncPanel('session-a', WIDE_CONTEXT)
    store.closePanel('session-a')

    expect(useSessionSummaryUIStore.getState().panels['session-a']?.expanded).toBe(false)
  })
})
