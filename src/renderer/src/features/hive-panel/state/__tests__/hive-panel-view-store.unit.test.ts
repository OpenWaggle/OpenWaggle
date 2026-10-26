import { describe, expect, it } from 'vitest'
import { migrateHivePanelView } from '../hive-panel-view-store'

describe('migrateHivePanelView', () => {
  it('opens a remembered "By state" choice as "By next actor" (issue 380)', () => {
    expect(
      migrateHivePanelView({ view: 'by-state', showArchived: true, collapsed: { a: true } }),
    ).toEqual({ view: 'by-next-actor', showArchived: true, collapsed: { a: true } })
  })

  it('keeps the tree, and starts from the defaults for anything unreadable', () => {
    expect(migrateHivePanelView({ view: 'tree', collapsed: { a: true, b: 'yes' } })).toEqual({
      view: 'tree',
      showArchived: false,
      collapsed: { a: true },
    })
    expect(migrateHivePanelView(null)).toEqual({ view: 'tree', showArchived: false, collapsed: {} })
  })
})
