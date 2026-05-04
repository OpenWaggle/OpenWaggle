import { describe, expect, it } from 'vitest'
import { resolveRightSidebarPanel } from '../right-sidebar-panel'

describe('resolveRightSidebarPanel', () => {
  it('keeps the active Session Tree panel rendered while it is open', () => {
    expect(
      resolveRightSidebarPanel({
        diffOpen: false,
        lastPanel: 'diff',
        sessionTreeOpen: true,
      }),
    ).toBe('session-tree')
  })

  it('keeps the active Diff panel rendered while it is open', () => {
    expect(
      resolveRightSidebarPanel({
        diffOpen: true,
        lastPanel: 'session-tree',
        sessionTreeOpen: false,
      }),
    ).toBe('diff')
  })

  it('preserves the last panel content while the shared sidebar closes', () => {
    expect(
      resolveRightSidebarPanel({
        diffOpen: false,
        lastPanel: 'session-tree',
        sessionTreeOpen: false,
      }),
    ).toBe('session-tree')
  })
})
