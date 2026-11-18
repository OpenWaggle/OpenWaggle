import { TERMINAL } from '@shared/constants/resource-limits'
import { describe, expect, it } from 'vitest'
import { runtimeKeyOf } from '../../lib/terminal-owner'
import {
  TERMINAL_STORE_OWNER as OWNER,
  resetTerminalStore as resetStore,
  terminalStore as store,
} from './terminal-store-test-harness'

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
    expect(group?.tabs[0]?.activePaneId).toBe(terminalId)
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
    expect(store().groups[OWNER]?.tabs[0]?.activePaneId).toBe(splitId)
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

  it('remembers an active pane per tab and chooses a neighbor after close', () => {
    resetStore()
    const { firstId, secondId } = seedSplitTab()
    const firstTabId = store().groups[OWNER]?.activeTabId
    if (firstTabId === null || firstTabId === undefined) throw new Error('Expected first tab')
    store().setActivePane(OWNER, firstTabId, firstId)
    const thirdId = store().createTerminal(OWNER, '/repo')
    const secondTabId = store().groups[OWNER]?.activeTabId
    if (thirdId === null || secondTabId === null || secondTabId === undefined) {
      throw new Error('Expected second tab')
    }

    store().setActiveTab(OWNER, firstTabId)
    expect(store().groups[OWNER]?.tabs.find((tab) => tab.id === firstTabId)?.activePaneId).toBe(
      firstId,
    )

    store().closePane(OWNER, firstId)
    expect(store().groups[OWNER]?.tabs.find((tab) => tab.id === firstTabId)?.activePaneId).toBe(
      secondId,
    )
    expect(store().groups[OWNER]?.tabs.find((tab) => tab.id === secondTabId)?.activePaneId).toBe(
      thirdId,
    )
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
    store().applyRuntimeEvent(OWNER, firstId, {
      type: 'port-previews',
      previews: [{ host: 'localhost', port: 3000, url: 'http://localhost:3000/' }],
    })
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

  it('moves one live tab between drawer and side-panel layouts without duplicating panes', () => {
    resetStore()
    const firstTerminalId = store().createTerminal(OWNER, '/repo')
    const firstTabId = store().groups[OWNER]?.activeTabId
    const secondTerminalId = store().createTerminal(OWNER, '/repo')
    if (
      firstTerminalId === null ||
      secondTerminalId === null ||
      firstTabId === null ||
      firstTabId === undefined
    ) {
      throw new Error('Expected two terminal tabs')
    }

    store().moveTab(OWNER, 'side-panel:owner-1', firstTabId)

    expect(store().groups[OWNER]?.tabs.flatMap((tab) => tab.panes)).toEqual([
      { terminalId: secondTerminalId, cwd: '/repo' },
    ])
    expect(store().groups['side-panel:owner-1']).toMatchObject({
      activeTabId: firstTabId,
      panelOpen: true,
    })
    expect(store().groups['side-panel:owner-1']?.tabs[0]?.panes).toEqual([
      { terminalId: firstTerminalId, cwd: '/repo' },
    ])
  })

  it('returns every side-panel tab to the drawer in one layout update', () => {
    resetStore()
    const sideOwner = 'side-panel:owner-1'
    store().createTerminal(sideOwner, '/repo')
    store().createTerminal(sideOwner, '/repo')

    store().moveAllTabs(sideOwner, OWNER)

    expect(store().groups[sideOwner]).toMatchObject({
      activeTabId: null,
      panelOpen: false,
      tabs: [],
    })
    expect(store().groups[OWNER]).toMatchObject({ panelOpen: true })
    expect(store().groups[OWNER]?.tabs).toHaveLength(2)
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

    store().setPanelHeight(OWNER, 10)
    expect(store().groups[OWNER]?.panelHeight).toBe(120)

    store().setPanelHeight(OWNER, 9999)
    expect(store().groups[OWNER]?.panelHeight).toBe(720)

    store().setPanelHeight(OWNER, 300.6)
    expect(store().groups[OWNER]?.panelHeight).toBe(301)
  })

  it('keeps panel visibility and height isolated per owner', () => {
    resetStore()

    store().setPanelOpen(OWNER, true)
    store().setPanelHeight(OWNER, 320)
    store().setPanelOpen('owner-2', false)
    store().setPanelHeight('owner-2', 480)

    expect(store().groups[OWNER]).toMatchObject({ panelOpen: true, panelHeight: 320 })
    expect(store().groups['owner-2']).toMatchObject({ panelOpen: false, panelHeight: 480 })
  })
})
