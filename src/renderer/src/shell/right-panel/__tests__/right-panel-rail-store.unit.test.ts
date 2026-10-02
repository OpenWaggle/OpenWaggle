import { beforeEach, describe, expect, it } from 'vitest'
import { extensionRightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import { DEFAULT_BUILT_IN_RAIL_ORDER } from '../right-panel-rail-order'
import {
  sanitizeRightPanelRailState,
  sessionRightPanelMemory,
  useRightPanelRailStore,
} from '../right-panel-rail-store'

const LINEAR = extensionRightPanelSurfaceId({ extensionId: 'linear', sidePanelId: 'issues' })

describe('Right panel rail store', () => {
  beforeEach(() => {
    useRightPanelRailStore.setState({
      order: null,
      hidden: [],
      acknowledged: [],
      extensionsInitialized: false,
      lastSurface: null,
      sessions: {},
      overflowing: [],
    })
  })

  it('discards unreadable persisted values instead of trusting them', () => {
    expect(
      sanitizeRightPanelRailState({
        order: ['changes', 'nope', 7, LINEAR, 'changes'],
        hidden: 'files',
        lastSurface: 'terminal',
        sessions: { 'session-1': { surface: 'browser', open: 'yes', lastFilePath: '' }, '': {} },
      }),
    ).toEqual({
      order: ['changes', LINEAR],
      hidden: [],
      acknowledged: [],
      extensionsInitialized: false,
      lastSurface: null,
      sessions: { 'session-1': { surface: 'browser', open: false, lastFilePath: null } },
    })
    expect(sanitizeRightPanelRailState(null).order).toBeNull()
  })

  it('pins, unpins, reorders and resets the rail', () => {
    const store = useRightPanelRailStore.getState()
    store.setPinned('files', false)
    expect(useRightPanelRailStore.getState().hidden).toEqual(['files'])
    store.move('resources', { type: 'before', target: 'changes' }, [...DEFAULT_BUILT_IN_RAIL_ORDER])
    expect(useRightPanelRailStore.getState().order?.[0]).toBe('resources')
    useRightPanelRailStore.getState().setPinned('files', true)
    expect(useRightPanelRailStore.getState().hidden).toEqual([])
    useRightPanelRailStore.getState().reset()
    expect(useRightPanelRailStore.getState()).toMatchObject({ order: null, hidden: [] })
  })

  it('keeps the slot of a panel that cannot run yet when the rail is first reordered', () => {
    const known = [...DEFAULT_BUILT_IN_RAIL_ORDER]
    useRightPanelRailStore
      .getState()
      .move('resources', { type: 'before', target: 'changes' }, known, [...known, LINEAR])
    expect(useRightPanelRailStore.getState().order).toContain(LINEAR)
  })

  it('acknowledges the first extension listing silently, then marks later ones new', () => {
    useRightPanelRailStore.getState().initializeExtensions([LINEAR])
    expect(useRightPanelRailStore.getState().acknowledged).toEqual([LINEAR])
    const later = extensionRightPanelSurfaceId({ extensionId: 'sentry', sidePanelId: 'errors' })
    useRightPanelRailStore.getState().initializeExtensions([LINEAR, later])
    expect(useRightPanelRailStore.getState().acknowledged).toEqual([LINEAR])
    useRightPanelRailStore.getState().acknowledge([later, LINEAR])
    expect(useRightPanelRailStore.getState().acknowledged).toEqual([LINEAR, later])
  })

  it('remembers each Session panel and the most recent surface anywhere', () => {
    const store = useRightPanelRailStore.getState()
    store.rememberSession('session-a', { surface: 'changes', open: true })
    store.rememberSession('session-b', { open: false })
    useRightPanelRailStore.getState().rememberSession('session-a', { open: false })

    expect(sessionRightPanelMemory('session-a')).toEqual({
      surface: 'changes',
      open: false,
      lastFilePath: null,
    })
    expect(sessionRightPanelMemory('session-b').surface).toBeNull()
    expect(sessionRightPanelMemory(null).open).toBe(false)
    expect(useRightPanelRailStore.getState().lastSurface).toBe('changes')
  })
})
