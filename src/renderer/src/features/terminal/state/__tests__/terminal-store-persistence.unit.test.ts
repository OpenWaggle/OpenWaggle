import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import {
  debouncedTerminalStorage,
  readStoredField,
  resolveTerminalStorage,
  sanitizeStoredGroups,
  sanitizeStoredPanelHeight,
  TERMINAL_PANEL_DEFAULT_HEIGHT,
  TERMINAL_STORAGE_KEY,
  terminalStorageOptions,
} from '../terminal-store-persistence'

const VALID_GROUP = {
  'session-1': {
    tabs: [
      {
        id: 'tab-1',
        panes: [{ terminalId: 't1', cwd: '/repo' }],
        splitDirection: 'stacked',
        customName: 'build',
      },
    ],
    activeTabId: 'tab-1',
  },
}

function makeBackingStorage() {
  const backing = {
    getItem: vi.fn((_name: string) => null),
    setItem: vi.fn((_name: string, _value: string) => undefined),
    removeItem: vi.fn((_name: string) => undefined),
  }
  return backing satisfies StateStorage
}

function stubWindowCapturingPagehide() {
  const pagehideListeners: Array<() => void> = []
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'pagehide') pagehideListeners.push(listener)
    },
  })
  return pagehideListeners
}

describe('sanitizeStoredGroups', () => {
  it('keeps structurally valid groups intact', () => {
    expect(sanitizeStoredGroups(VALID_GROUP)).toEqual(VALID_GROUP)
  })

  it('drops a group whose tabs hold no valid panes', () => {
    const input = {
      'session-1': {
        tabs: [{ id: 'tab-1', panes: [{ cwd: '/repo' }], splitDirection: 'stacked' }],
        activeTabId: 'tab-1',
      },
    }

    expect(sanitizeStoredGroups(input)).toEqual({})
  })

  it('drops panes missing an id or a working path, keeping valid siblings', () => {
    const input = {
      'session-1': {
        tabs: [
          {
            id: 'tab-1',
            panes: [
              { terminalId: 't1' },
              { terminalId: 't2', cwd: '' },
              { terminalId: 't3', cwd: '/repo' },
            ],
            splitDirection: 'side-by-side',
          },
        ],
        activeTabId: 'tab-1',
      },
    }

    const result = sanitizeStoredGroups(input)

    expect(result['session-1']?.tabs[0]?.panes).toEqual([{ terminalId: 't3', cwd: '/repo' }])
  })

  it('falls back to the last tab id when the stored activeTabId is stale', () => {
    const input = {
      'session-1': {
        tabs: [
          { id: 'tab-1', panes: [{ terminalId: 't1', cwd: '/repo' }] },
          { id: 'tab-2', panes: [{ terminalId: 't2', cwd: '/repo' }] },
        ],
        activeTabId: 'vanishes-after-reload',
      },
    }

    expect(sanitizeStoredGroups(input)['session-1']?.activeTabId).toBe('tab-2')
  })

  it('returns an empty record for non-object input', () => {
    expect(sanitizeStoredGroups(null)).toEqual({})
    expect(sanitizeStoredGroups('groups')).toEqual({})
    expect(sanitizeStoredGroups(42)).toEqual({})
    expect(sanitizeStoredGroups([])).toEqual({})
  })

  it('drops unknown extra fields from groups, tabs, and panes', () => {
    const input = {
      'session-1': {
        tabs: [
          {
            id: 'tab-1',
            panes: [{ terminalId: 't1', cwd: '/repo', stalePaneField: true }],
            splitDirection: 'stacked',
            customName: null,
            staleTabField: true,
          },
        ],
        activeTabId: 'tab-1',
        staleGroupField: true,
      },
    }

    expect(sanitizeStoredGroups(input)).toEqual({
      'session-1': {
        tabs: [
          {
            id: 'tab-1',
            panes: [{ terminalId: 't1', cwd: '/repo' }],
            splitDirection: 'stacked',
            customName: null,
          },
        ],
        activeTabId: 'tab-1',
      },
    })
  })

  it('normalizes unknown split directions to side-by-side', () => {
    const input = {
      'session-1': {
        tabs: [
          { id: 'tab-1', panes: [{ terminalId: 't1', cwd: '/repo' }], splitDirection: 'diagonal' },
        ],
        activeTabId: 'tab-1',
      },
    }

    expect(sanitizeStoredGroups(input)['session-1']?.tabs[0]?.splitDirection).toBe('side-by-side')
  })
})

describe('sanitizeStoredPanelHeight', () => {
  it('returns the default height for non-numeric and non-finite input', () => {
    expect(sanitizeStoredPanelHeight(undefined)).toBe(TERMINAL_PANEL_DEFAULT_HEIGHT)
    expect(sanitizeStoredPanelHeight('500')).toBe(TERMINAL_PANEL_DEFAULT_HEIGHT)
    expect(sanitizeStoredPanelHeight(Number.NaN)).toBe(TERMINAL_PANEL_DEFAULT_HEIGHT)
    expect(sanitizeStoredPanelHeight(Number.POSITIVE_INFINITY)).toBe(TERMINAL_PANEL_DEFAULT_HEIGHT)
  })

  it('clamps to the panel height band and rounds', () => {
    expect(sanitizeStoredPanelHeight(50)).toBe(120)
    expect(sanitizeStoredPanelHeight(9999)).toBe(720)
    expect(sanitizeStoredPanelHeight(300.4)).toBe(300)
  })
})

describe('readStoredField', () => {
  it('reads fields from objects and returns undefined for anything else', () => {
    expect(readStoredField({ groups: VALID_GROUP }, 'groups')).toEqual(VALID_GROUP)
    expect(readStoredField(null, 'groups')).toBeUndefined()
    expect(readStoredField('groups', 'groups')).toBeUndefined()
  })
})

describe('resolveTerminalStorage', () => {
  it('falls back to memory storage without a window and round-trips values', () => {
    const storage = resolveTerminalStorage()

    storage.setItem('key', 'value')
    expect(storage.getItem('key')).toBe('value')
    storage.removeItem('key')
    expect(storage.getItem('key')).toBeNull()
  })
})

describe('terminalStorageOptions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips a persisted snapshot through the debounced storage chain', async () => {
    const storage = terminalStorageOptions()
    const snapshot = { state: { groups: VALID_GROUP }, version: 1 }

    await storage.setItem(TERMINAL_STORAGE_KEY, snapshot)

    expect(storage.getItem(TERMINAL_STORAGE_KEY)).toEqual(snapshot)
  })
})

describe('debouncedTerminalStorage', () => {
  let backing: ReturnType<typeof makeBackingStorage>

  beforeEach(() => {
    vi.useFakeTimers()
    backing = makeBackingStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('coalesces writes inside the window and flushes the last value', () => {
    const storage = debouncedTerminalStorage(backing)

    storage.setItem(TERMINAL_STORAGE_KEY, 'first')
    storage.setItem(TERMINAL_STORAGE_KEY, 'second')
    vi.advanceTimersByTime(499)
    expect(backing.setItem).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(backing.setItem).toHaveBeenCalledExactlyOnceWith(TERMINAL_STORAGE_KEY, 'second')
  })

  it('serves queued values from getItem before the flush lands', () => {
    const storage = debouncedTerminalStorage(backing)

    storage.setItem(TERMINAL_STORAGE_KEY, 'queued')

    expect(storage.getItem(TERMINAL_STORAGE_KEY)).toBe('queued')
    expect(backing.getItem).not.toHaveBeenCalled()
  })

  it('removeItem drops the queued value and delegates the removal', () => {
    const storage = debouncedTerminalStorage(backing)

    storage.setItem(TERMINAL_STORAGE_KEY, 'queued')
    storage.removeItem(TERMINAL_STORAGE_KEY)
    vi.advanceTimersByTime(1000)

    expect(backing.setItem).not.toHaveBeenCalled()
    expect(backing.removeItem).toHaveBeenCalledWith(TERMINAL_STORAGE_KEY)
  })

  it('flushes queued writes when the page hides', () => {
    const pagehideListeners = stubWindowCapturingPagehide()
    const storage = debouncedTerminalStorage(backing)

    storage.setItem(TERMINAL_STORAGE_KEY, 'before-hide')
    for (const flush of pagehideListeners) flush()

    expect(backing.setItem).toHaveBeenCalledExactlyOnceWith(TERMINAL_STORAGE_KEY, 'before-hide')
  })
})
