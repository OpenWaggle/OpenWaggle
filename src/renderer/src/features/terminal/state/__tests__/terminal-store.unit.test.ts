import { TERMINAL } from '@shared/constants/resource-limits'
import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { runtimeKeyOf, terminalOwnerContext, terminalTabTitle } from '../../lib/terminal-owner'
import { TERMINAL_PANEL_DEFAULT_HEIGHT, useTerminalStore } from '../terminal-store'

const OWNER = 'owner-1'

function resetStore() {
  useTerminalStore.setState({
    groups: {},
    panelHeight: TERMINAL_PANEL_DEFAULT_HEIGHT,
    activity: {},
    portPreviews: {},
    exits: {},
  })
}

function store() {
  return useTerminalStore.getState()
}

function seedSplitTab() {
  const firstId = store().createTerminal(OWNER, '/repo')
  const tabId = store().groups[OWNER]?.tabs[0]?.id
  if (firstId === null || tabId === undefined) throw new Error('Expected seeded terminal')
  const secondId = store().splitTerminal(OWNER, tabId, '/repo')
  if (secondId === null) throw new Error('Expected split terminal id')
  return { firstId, secondId }
}

describe('terminal store layout', () => {
  it('createTerminal returns a new id and activates its tab', () => {
    resetStore()

    const terminalId = store().createTerminal(OWNER, '/repo')

    expect(terminalId).toEqual(expect.any(String))
    const group = store().groups[OWNER]
    expect(group?.tabs).toHaveLength(1)
    expect(group?.tabs[0]?.panes).toEqual([{ terminalId, cwd: '/repo' }])
    expect(group?.activeTabId).toBe(group?.tabs[0]?.id)
  })

  it('createTerminal refuses an empty working path', () => {
    resetStore()

    expect(store().createTerminal(OWNER, '')).toBeNull()
    expect(store().groups[OWNER]?.tabs ?? []).toHaveLength(0)
  })

  it('splitTerminal appends a pane to the target tab', () => {
    resetStore()
    const firstId = store().createTerminal(OWNER, '/repo')
    const tabId = store().groups[OWNER]?.tabs[0]?.id
    if (firstId === null || tabId === undefined) throw new Error('Expected seeded terminal')

    const splitId = store().splitTerminal(OWNER, tabId, '/repo')

    expect(splitId).toEqual(expect.any(String))
    const panes = store().groups[OWNER]?.tabs[0]?.panes
    expect(panes?.map((pane) => pane.terminalId)).toEqual([firstId, splitId])
  })

  it('splitTerminal refuses beyond the pane cap or for unknown tabs', () => {
    resetStore()
    const firstId = store().createTerminal(OWNER, '/repo')
    const tabId = store().groups[OWNER]?.tabs[0]?.id
    if (firstId === null || tabId === undefined) throw new Error('Expected seeded terminal')

    const ids = [firstId]
    while (ids.length < TERMINAL.MAX_PANES_PER_TAB) {
      const id = store().splitTerminal(OWNER, tabId, '/repo')
      if (id === null) throw new Error('Expected split before the cap')
      ids.push(id)
    }

    expect(store().splitTerminal(OWNER, tabId, '/repo')).toBeNull()
    expect(store().splitTerminal(OWNER, 'missing-tab', '/repo')).toBeNull()
    expect(store().splitTerminal(OWNER, tabId, '')).toBeNull()
    expect(store().groups[OWNER]?.tabs[0]?.panes).toHaveLength(TERMINAL.MAX_PANES_PER_TAB)
  })

  it('setSplitDirection toggles the layout of one tab', () => {
    resetStore()
    store().createTerminal(OWNER, '/repo')
    const tabId = store().groups[OWNER]?.tabs[0]?.id
    if (tabId === undefined) throw new Error('Expected tab id')

    store().setSplitDirection(OWNER, tabId, 'stacked')

    expect(store().groups[OWNER]?.tabs[0]?.splitDirection).toBe('stacked')
  })

  it('closePane removes one pane, and drops the tab when it was the last pane', () => {
    resetStore()
    const { firstId, secondId } = seedSplitTab()

    store().closePane(OWNER, firstId)

    let group = store().groups[OWNER]
    expect(group?.tabs).toHaveLength(1)
    expect(group?.tabs[0]?.panes.map((pane) => pane.terminalId)).toEqual([secondId])
    expect(group?.activeTabId).not.toBeNull()

    store().closePane(OWNER, secondId)

    group = store().groups[OWNER]
    expect(group?.tabs).toHaveLength(0)
    expect(group?.activeTabId).toBeNull()
  })

  it('closeTab returns every closed terminal id and clears their runtime keys', () => {
    resetStore()
    const firstId = store().createTerminal(OWNER, '/repo')
    const tabId = store().groups[OWNER]?.tabs[0]?.id
    if (firstId === null || tabId === undefined) throw new Error('Expected seeded terminal')
    const secondId = store().splitTerminal(OWNER, tabId, '/repo')
    const survivor = store().createTerminal(OWNER, '/repo')
    if (secondId === null || survivor === null) throw new Error('Expected survivor terminal id')
    store().applyRuntimeEvent(OWNER, firstId, { type: 'activity', processName: 'vitest' })
    store().applyRuntimeEvent(OWNER, firstId, { type: 'ports', ports: [3000] })
    store().applyRuntimeEvent(OWNER, firstId, { type: 'exited', exitCode: 1 })

    const closedIds = store().closeTab(OWNER, tabId)

    expect(closedIds).toEqual([firstId, secondId])
    const state = store()
    expect(state.groups[OWNER]?.tabs).toHaveLength(1)
    expect(state.groups[OWNER]?.activeTabId).not.toBeNull()
    expect(state.activity[runtimeKeyOf(OWNER, firstId)]).toBeUndefined()
    expect(state.portPreviews[runtimeKeyOf(OWNER, firstId)]).toBeUndefined()
    expect(state.exits[runtimeKeyOf(OWNER, firstId)]).toBeUndefined()
  })

  it('closeTab on an unknown tab returns no ids', () => {
    resetStore()

    expect(store().closeTab(OWNER, 'missing-tab')).toEqual([])
  })

  it('renameTab trims names, rejects blanks, and null clears the custom name', () => {
    resetStore()
    store().createTerminal(OWNER, '/repo')
    const tabId = store().groups[OWNER]?.tabs[0]?.id
    if (tabId === undefined) throw new Error('Expected tab id')

    store().renameTab(OWNER, tabId, '  build  ')
    expect(store().groups[OWNER]?.tabs[0]?.customName).toBe('build')

    store().renameTab(OWNER, tabId, '   ')
    expect(store().groups[OWNER]?.tabs[0]?.customName).toBeNull()

    store().renameTab(OWNER, tabId, 'server')
    store().renameTab(OWNER, tabId, null)
    expect(store().groups[OWNER]?.tabs[0]?.customName).toBeNull()
  })

  it('removeGroup drops the whole owner entry', () => {
    resetStore()
    store().createTerminal(OWNER, '/repo')

    store().removeGroup(OWNER)

    expect(store().groups[OWNER]).toBeUndefined()
  })

  it('setPanelHeight clamps to the 120..720 band and rounds', () => {
    resetStore()

    store().setPanelHeight(10)
    expect(store().panelHeight).toBe(120)

    store().setPanelHeight(9999)
    expect(store().panelHeight).toBe(720)

    store().setPanelHeight(300.6)
    expect(store().panelHeight).toBe(301)
  })
})

describe('terminal store runtime events', () => {
  it('applyRuntimeEvent records activity, ports, and exits under the runtime key', () => {
    resetStore()

    store().applyRuntimeEvent(OWNER, 'term-1', { type: 'activity', processName: 'vite' })
    store().applyRuntimeEvent(OWNER, 'term-1', { type: 'ports', ports: [5173, 3000] })
    store().applyRuntimeEvent(OWNER, 'term-1', { type: 'exited', exitCode: 2 })
    // Other owners must stay isolated.
    store().applyRuntimeEvent('owner-2', 'term-1', { type: 'activity', processName: 'x' })

    const state = store()
    const runtime = runtimeKeyOf(OWNER, 'term-1')
    expect(state.activity[runtime]).toBe('vite')
    expect(state.portPreviews[runtime]).toEqual([5173, 3000])
    expect(state.exits[runtime]).toBe(2)
    expect(state.activity[runtimeKeyOf('owner-2', 'term-1')]).toBe('x')
  })

  it('applyRuntimeEvent ignores output and cleared events', () => {
    resetStore()

    store().applyRuntimeEvent(OWNER, 'term-1', { type: 'output', data: 'hello' })
    store().applyRuntimeEvent(OWNER, 'term-1', { type: 'cleared' })

    const state = store()
    expect(state.activity).toEqual({})
    expect(state.portPreviews).toEqual({})
    expect(state.exits).toEqual({})
  })

  it('clearExit removes only that terminal exit entry', () => {
    resetStore()
    store().applyRuntimeEvent(OWNER, 'term-1', { type: 'exited', exitCode: 1 })
    store().applyRuntimeEvent(OWNER, 'term-2', { type: 'exited', exitCode: 2 })

    store().clearExit(OWNER, 'term-1')

    const state = store()
    expect(state.exits[runtimeKeyOf(OWNER, 'term-1')]).toBeUndefined()
    expect(state.exits[runtimeKeyOf(OWNER, 'term-2')]).toBe(2)
  })
})

describe('terminalTabTitle', () => {
  const tab = (panes: string[], customName: string | null) => ({
    id: 'tab-1',
    panes: panes.map((terminalId) => ({ terminalId, cwd: '/repo' })),
    splitDirection: 'side-by-side' as const,
    customName,
  })

  it('prefers the custom name over everything', () => {
    const title = terminalTabTitle(OWNER, tab(['t1'], 'build'), 0, {
      [runtimeKeyOf(OWNER, 't1')]: 'vite',
    })

    expect(title).toBe('build')
  })

  it('falls back to the primary pane foreground process name', () => {
    expect(
      terminalTabTitle(OWNER, tab(['t1'], null), 0, {
        [runtimeKeyOf(OWNER, 't1')]: 'vite',
      }),
    ).toBe('vite')
  })

  it('ignores blank activity names and labels by index otherwise', () => {
    expect(terminalTabTitle(OWNER, tab(['t1'], null), 0, { [runtimeKeyOf(OWNER, 't1')]: '' })).toBe(
      'Terminal 1',
    )
    expect(terminalTabTitle(OWNER, tab(['t1'], null), 2, {})).toBe('Terminal 3')
  })
})

describe('runtimeKeyOf', () => {
  it('joins owner and terminal id with the canonical separator', () => {
    expect(runtimeKeyOf('session-1', 'term-9')).toBe('session-1::term-9')
  })
})

describe('terminalOwnerContext', () => {
  it('binds a session to its id and resolves local mode to the opened checkout', () => {
    const context = terminalOwnerContext(
      { id: SessionId('session-1'), environmentMode: 'local', projectPath: '/repo' },
      '/opened',
    )

    expect(context).toEqual({ ownerKey: 'session-1', defaultCwd: '/repo' })
  })

  it('resolves worktree mode to the Session worktree path', () => {
    const context = terminalOwnerContext(
      {
        id: SessionId('session-2'),
        environmentMode: 'worktree',
        worktreePath: '/repo/.worktrees/session-2',
        projectPath: '/repo',
      },
      '/opened',
    )

    expect(context).toEqual({
      ownerKey: 'session-2',
      defaultCwd: '/repo/.worktrees/session-2',
    })
  })

  it('falls back to the opened project when the session has no project path', () => {
    const context = terminalOwnerContext(
      { id: SessionId('session-3'), environmentMode: 'local', projectPath: null },
      '/opened',
    )

    expect(context).toEqual({ ownerKey: 'session-3', defaultCwd: '/opened' })
  })

  it('binds an unsent draft to the draft project path', () => {
    const context = terminalOwnerContext(null, '/tmp/project-x')

    expect(context).toEqual({ ownerKey: 'draft:/tmp/project-x', defaultCwd: '/tmp/project-x' })
  })

  it('has no owner without a project', () => {
    expect(terminalOwnerContext(null, null)).toEqual({ ownerKey: '', defaultCwd: null })
  })
})
