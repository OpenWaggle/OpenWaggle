import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { extensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extensionSidePanelSurfaces } from '@/features/extensions'
import { registerRightPanelController } from '@/shared/lib/right-panel-surfaces'
import { createPanelCommandItems, showPanelSurface } from '../global-command-panel-items'

const NOTES = extensionRightPanelSurfaceId({ extensionId: 'acme.notes', sidePanelId: 'notes' })

function sidePanelEntry(): ExtensionContributionRegistryEntry {
  return {
    extensionId: 'acme.notes',
    extensionName: 'Acme Notes',
    extensionVersion: '1.0.0',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' },
    packagePath: '/extensions/acme-notes',
    manifestPath: '/extensions/acme-notes/openwaggle.extension.json',
    contentHash: 'hash-1',
    projectPaths: ['/repo'],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
    contributionId: 'notes',
    title: 'Notes',
    label: 'Notes',
    runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
    execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
    entryPath: 'modules/notes.js',
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted: true,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
    },
    diagnostics: [],
  }
}

const PANELS = extensionSidePanelSurfaces({
  projectPaths: ['/repo'],
  // The same panel listed twice (for example from two scopes) appears once.
  entries: [sidePanelEntry(), { ...sidePanelEntry(), contentHash: 'hash-2' }],
})
const SETTINGS = {
  ...DEFAULT_SETTINGS,
  extensionPanelShortcutBindings: { [NOTES]: { key: 'G', mod: true, shift: true } },
}

describe('createPanelCommandItems', () => {
  let unregister: (() => void) | null = null

  afterEach(() => {
    unregister?.()
    unregister = null
  })

  it('lists every surface once in rail order with its current binding', () => {
    const items = createPanelCommandItems({
      settings: SETTINGS,
      extensionPanels: PANELS,
      showSurface: vi.fn(),
    })

    expect(items.map((item) => [item.label, item.section, item.trailing])).toEqual([
      ['All panels', 'Panels', undefined],
      ['Changes', 'Panels', 'Ctrl + D'],
      ['Project Actions', 'Panels', undefined],
      ['Browser', 'Panels', 'Ctrl + Shift + J'],
      ['Files', 'Panels', undefined],
      ['Session Tree', 'Panels', 'Ctrl + Shift + Y'],
      ['Resources', 'Panels', undefined],
      ['Notes', 'Panels', 'Ctrl + Shift + G'],
    ])
    expect(items.at(-1)).toMatchObject({ description: 'Acme Notes', trailingBadge: 'Global' })
  })

  it('shows the chosen surface with its extension panel', () => {
    const showSurface = vi.fn()
    const items = createPanelCommandItems({
      settings: SETTINGS,
      extensionPanels: PANELS,
      showSurface,
    })

    items.find((item) => item.label === 'Files')?.action()
    items.find((item) => item.label === 'Notes')?.action()

    expect(showSurface).toHaveBeenNthCalledWith(1, 'files', undefined)
    expect(showSurface).toHaveBeenNthCalledWith(2, NOTES, PANELS[0])
  })

  it('disables a surface with the reason supplied by the Right panel owner', () => {
    const showSurface = vi.fn()
    const items = createPanelCommandItems({
      settings: SETTINGS,
      extensionPanels: PANELS,
      showSurface,
      disabledReason: (id) => (id === 'changes' ? 'Open a project with Git first' : null),
    })
    const changes = items.find((item) => item.label === 'Changes')

    expect(changes).toMatchObject({ disabled: true, description: 'Open a project with Git first' })
    changes?.action()
    expect(showSurface).not.toHaveBeenCalled()
  })

  it('lists a panel that only needs trust as disabled with what it needs', () => {
    const untrusted = sidePanelEntry()
    const panels = extensionSidePanelSurfaces({
      projectPaths: ['/repo'],
      entries: [
        { ...untrusted, eligibility: { ...untrusted.eligibility, trusted: false } },
        {
          ...untrusted,
          contributionId: 'off',
          eligibility: { ...untrusted.eligibility, enabled: false },
        },
      ],
    })
    expect(panels.map((panel) => [panel.entry.contributionId, panel.cannotRunYet])).toEqual([
      ['notes', true],
      ['off', false],
    ])

    // A turned-off copy listed first does not hide a copy that only needs trust.
    const [preferred] = extensionSidePanelSurfaces({
      projectPaths: ['/repo'],
      entries: [
        { ...untrusted, eligibility: { ...untrusted.eligibility, enabled: false } },
        { ...untrusted, eligibility: { ...untrusted.eligibility, trusted: false } },
      ],
    })
    expect(preferred?.cannotRunYet).toBe(true)
    const showSurface = vi.fn()
    const notes = createPanelCommandItems({
      settings: SETTINGS,
      extensionPanels: panels.filter((panel) => panel.cannotRunYet),
      showSurface,
    }).find((item) => item.label === 'Notes')

    expect(notes).toMatchObject({
      disabled: true,
      description: expect.stringContaining('Cannot run yet'),
    })
    notes?.action()
    expect(showSurface).not.toHaveBeenCalled()
  })

  it('shows surfaces through the controller and never toggles them', () => {
    const controller = {
      toggleSurface: vi.fn(),
      showSurface: vi.fn(),
      togglePanel: vi.fn(),
      closePanel: vi.fn(),
    }
    unregister = registerRightPanelController(controller)
    const legacy = { openBuiltInPanel: vi.fn(), openExtensionPanel: vi.fn() }

    showPanelSurface('changes', undefined, legacy)
    showPanelSurface(NOTES, PANELS[0], legacy)

    expect(controller.showSurface.mock.calls).toEqual([['changes'], [NOTES]])
    expect(controller.toggleSurface).not.toHaveBeenCalled()
    expect(legacy.openBuiltInPanel).not.toHaveBeenCalled()
  })

  it('falls back to the route panels while no controller is registered', () => {
    const legacy = { openBuiltInPanel: vi.fn(), openExtensionPanel: vi.fn() }

    showPanelSurface('changes', undefined, legacy)
    showPanelSurface('session-tree', undefined, legacy)
    showPanelSurface(NOTES, PANELS[0], legacy)

    expect(legacy.openBuiltInPanel.mock.calls).toEqual([['diff'], ['session-tree']])
    expect(legacy.openExtensionPanel).toHaveBeenCalledWith(PANELS[0]?.entry)
  })
})
