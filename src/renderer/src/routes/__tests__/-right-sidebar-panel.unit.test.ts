import { describe, expect, it } from 'vitest'
import { resolveRightSidebarPanel } from '../-right-sidebar-panel'

describe('resolveRightSidebarPanel', () => {
  it('keeps the active Session Tree panel rendered while it is open', () => {
    expect(
      resolveRightSidebarPanel({
        diffOpen: false,
        extensionSidePanel: null,
        lastPanel: 'diff',
        sessionTreeOpen: true,
      }),
    ).toBe('session-tree')
  })

  it('keeps the active Diff panel rendered while it is open', () => {
    expect(
      resolveRightSidebarPanel({
        diffOpen: true,
        extensionSidePanel: null,
        lastPanel: 'session-tree',
        sessionTreeOpen: false,
      }),
    ).toBe('diff')
  })

  it('keeps the active extension side panel rendered while it is open', () => {
    expect(
      resolveRightSidebarPanel({
        diffOpen: false,
        extensionSidePanel: {
          extensionId: 'sample-extension',
          sidePanelId: 'sample.side-panel',
        },
        lastPanel: 'diff',
        sessionTreeOpen: false,
      }),
    ).toEqual({
      kind: 'extension-side-panel',
      extensionId: 'sample-extension',
      sidePanelId: 'sample.side-panel',
    })
  })

  it('preserves the last panel content while the shared sidebar closes', () => {
    expect(
      resolveRightSidebarPanel({
        diffOpen: false,
        extensionSidePanel: null,
        lastPanel: 'session-tree',
        sessionTreeOpen: false,
      }),
    ).toBe('session-tree')
  })
})
