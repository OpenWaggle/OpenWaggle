import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { extensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerRightPanelController } from '@/shared/lib/right-panel-surfaces'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const NOTES = extensionRightPanelSurfaceId({ extensionId: 'acme.notes', sidePanelId: 'notes' })

const mocks = vi.hoisted(() => {
  const settings: { current: Settings | null } = { current: null }
  return {
    close: vi.fn(),
    openBuiltInPanel: vi.fn(),
    openExtensionPanel: vi.fn(),
    listExtensionContributions: vi.fn(),
    settings,
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: { listExtensionContributions: mocks.listExtensionContributions },
}))
vi.mock('../../hooks/useGlobalCommandActions', async () => {
  const { DEFAULT_SETTINGS: defaults } = await import('@shared/types/settings')
  return {
    useGlobalCommandActions: () => ({
      actions: {
        finish: (action: () => void) => action(),
        openBuiltInPanel: mocks.openBuiltInPanel,
      },
      close: mocks.close,
      projectPath: '/repo',
      sessionId: 'session-1',
      sessions: [],
      settings: mocks.settings.current ?? defaults,
    }),
  }
})
vi.mock('../../hooks/useGlobalExtensionActions', () => ({
  useGlobalExtensionActions: () => ({
    invokeExtensionCommand: vi.fn(),
    openExtensionPanel: mocks.openExtensionPanel,
  }),
}))
vi.mock('@/features/project-actions', () => ({
  createProjectActionCommandItems: () => [],
  useProjectActions: () => ({ data: [] }),
  useRunProjectAction: () => vi.fn(),
}))
vi.mock('@/features/terminal', () => ({ useRunningTerminalCounts: () => new Map() }))

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
    category: 'Writing',
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

async function renderPalette() {
  const { GlobalCommandPalette } = await import('../GlobalCommandPalette')
  renderWithQueryClient(<GlobalCommandPalette />)
  await screen.findByRole('menuitem', { name: /Notes/ })
}

function panelLabels() {
  const items = screen.getAllByRole('menuitem')
  const first = items.findIndex((item) => within(item).queryByText('All panels') !== null)
  return items.slice(first, first + 8).map((item) => item.textContent)
}

describe('GlobalCommandPalette Panels section', () => {
  const controller = {
    toggleSurface: vi.fn(),
    showSurface: vi.fn(),
    togglePanel: vi.fn(),
    closePanel: vi.fn(),
  }
  let unregister: (() => void) | null = null

  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function showModal() {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close ??= function close() {
      this.removeAttribute('open')
    }
    Element.prototype.scrollIntoView ??= function scrollIntoView() {}
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settings.current = {
      ...DEFAULT_SETTINGS,
      extensionPanelShortcutBindings: { [NOTES]: { key: 'G', mod: true, shift: true } },
    }
    mocks.listExtensionContributions.mockResolvedValue({
      projectPaths: ['/repo'],
      entries: [sidePanelEntry()],
    })
  })

  afterEach(() => {
    unregister?.()
    unregister = null
  })

  it('lists each surface once with its binding, extension panels under their extension name', async () => {
    await renderPalette()

    expect(screen.getByText('Panels')).toBeInTheDocument()
    expect(panelLabels()).toEqual([
      'All panelsEvery panel you can open here, with its shortcut',
      'ChangesReview the working tree diffCtrl + D',
      'Project ActionsRun, stop and inspect project actions',
      'BrowserPreview pages in the session browserCtrl + Shift + J',
      'FilesBrowse and edit workspace files',
      'Session TreeInspect branches and session historyCtrl + Shift + Y',
      'ResourcesSources and outputs captured in this session',
      // The leading N is the extension's letter-tile icon.
      'NNotesAcme NotesGlobalCtrl + Shift + G',
    ])
    // The surfaces moved into Panels are not repeated elsewhere.
    expect(screen.queryByText('Toggle diff panel')).not.toBeInTheDocument()
    expect(screen.queryByText('Open session tree')).not.toBeInTheDocument()
    expect(screen.queryByText('Writing')).not.toBeInTheDocument()
  })

  it('shows the chosen surface through the Right panel controller', async () => {
    unregister = registerRightPanelController(controller)
    await renderPalette()

    fireEvent.click(screen.getByRole('menuitem', { name: /^Notes/ }))

    expect(mocks.close).toHaveBeenCalled()
    expect(controller.showSurface).toHaveBeenCalledWith(NOTES)
    expect(controller.toggleSurface).not.toHaveBeenCalled()
  })

  it('runs the highlighted panel with Enter after filtering', async () => {
    unregister = registerRightPanelController(controller)
    await renderPalette()

    const search = screen.getByRole('textbox', { name: 'Search commands' })
    fireEvent.change(search, { target: { value: 'session tree' } })
    fireEvent.keyDown(search, { key: 'Enter' })

    await waitFor(() => expect(controller.showSurface).toHaveBeenCalledWith('session-tree'))
  })

  it('opens the legacy route panel while no controller is registered', async () => {
    await renderPalette()

    fireEvent.click(screen.getByRole('menuitem', { name: /^Changes/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Notes/ }))

    expect(mocks.openBuiltInPanel).toHaveBeenCalledWith('diff')
    expect(mocks.openExtensionPanel).toHaveBeenCalledWith({ entry: sidePanelEntry() })
  })
})
