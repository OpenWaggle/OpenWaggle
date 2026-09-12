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
    useSessionSummaryUIStore.setState({ panels: {}, toggleFocusTargetSessionId: null })
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
    expect(localStorage.getItem('openwaggle:session-summary:session-a:panel')).toBeNull()
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

  it('treats a narrow-width override as transient across layout changes', () => {
    const store = useSessionSummaryUIStore.getState()
    store.syncPanel('session-a', { ...WIDE_CONTEXT, autoHidden: true })
    store.togglePanel('session-a')
    store.syncPanel('session-a', WIDE_CONTEXT)
    store.syncPanel('session-a', { ...WIDE_CONTEXT, autoHidden: true })

    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-a']),
    ).toBe(false)
    expect(useSessionSummaryUIStore.getState().panels['session-a']?.forcedOpen).toBe(false)
  })

  it('preserves persistent user intent while a right sidebar suppresses visibility', () => {
    const store = useSessionSummaryUIStore.getState()
    store.syncPanel('session-a', { ...WIDE_CONTEXT, rightSidebarOpen: true })

    store.togglePanel('session-a')
    expect(useSessionSummaryUIStore.getState().panels['session-a']?.expanded).toBe(true)
    expect(useSessionSummaryUIStore.getState().panels['session-a']?.forcedOpen).toBe(false)
    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-a']),
    ).toBe(false)
  })

  it('temporarily suppresses a transient narrow-width panel while a sidebar is open', () => {
    const store = useSessionSummaryUIStore.getState()
    const narrowContext = { ...WIDE_CONTEXT, autoHidden: true }
    store.syncPanel('session-a', narrowContext)
    store.togglePanel('session-a')
    expect(useSessionSummaryUIStore.getState().panels['session-a']?.forcedOpen).toBe(true)

    store.syncPanel('session-a', { ...narrowContext, rightSidebarOpen: true })
    expect(useSessionSummaryUIStore.getState().panels['session-a']).toMatchObject({
      expanded: true,
      forcedOpen: true,
    })
    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-a']),
    ).toBe(false)
    store.syncPanel('session-a', narrowContext)
    expect(
      isSessionSummaryPanelVisible(useSessionSummaryUIStore.getState().panels['session-a']),
    ).toBe(true)
  })

  it('dismisses only the transient override without changing the wide-layout preference', () => {
    const store = useSessionSummaryUIStore.getState()
    store.syncPanel('session-a', { ...WIDE_CONTEXT, autoHidden: true })
    store.togglePanel('session-a')

    store.dismissTransientPanel('session-a')

    expect(useSessionSummaryUIStore.getState().panels['session-a']).toMatchObject({
      expanded: true,
      forcedOpen: false,
    })
    expect(localStorage.getItem('openwaggle:session-summary:session-a:panel')).toBeNull()
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

  it('clears a Hive navigation focus request only for its target session', () => {
    const store = useSessionSummaryUIStore.getState()
    store.requestToggleFocus('session-b')
    store.clearToggleFocus('session-a')
    expect(useSessionSummaryUIStore.getState().toggleFocusTargetSessionId).toBe('session-b')

    store.clearToggleFocus('session-b')
    expect(useSessionSummaryUIStore.getState().toggleFocusTargetSessionId).toBeNull()
  })
})
