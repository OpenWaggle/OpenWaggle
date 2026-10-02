import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { extensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import {
  DEFAULT_SHORTCUT_RULES,
  shortcutBindingsFromRules,
  shortcutRulesWithDefaults,
} from '@shared/types/shortcuts'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const apiMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  listExtensionContributions: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))
vi.mock('@/features/project-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/project-actions')>()),
  useProjectActions: () => ({ data: [], isError: false }),
  useProjectActionMutations: () => ({ update: vi.fn(), isSaving: false }),
}))

import { usePreferencesStore } from '../../state/preferences-store'
import { ShortcutsSection } from '../sections/ShortcutsSection'

const NOTES = extensionRightPanelSurfaceId({ extensionId: 'acme.notes', sidePanelId: 'notes' })
const REMOVED = extensionRightPanelSurfaceId({ extensionId: 'acme.gone', sidePanelId: 'board' })

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

function panels() {
  return within(screen.getByRole('region', { name: 'Panels' }))
}

function record(name: string, key: string, modifiers: { shiftKey?: boolean } = {}) {
  const recorder = panels().getByRole('button', { name })
  fireEvent.click(recorder)
  fireEvent.keyDown(recorder, { key, ctrlKey: true, ...modifiers })
}

describe('Settings › Shortcuts › Panels', () => {
  let persistedSettings: Settings

  beforeEach(() => {
    vi.clearAllMocks()
    persistedSettings = {
      ...DEFAULT_SETTINGS,
      projectPath: '/repo',
      extensionPanelShortcutBindings: { [REMOVED]: { key: 'K', mod: true, alt: true } },
    }
    usePreferencesStore.setState({ settings: persistedSettings })
    apiMock.updateSettings.mockImplementation(async (partial: Partial<Settings>) => {
      // Like the main process, a command without rules gets its default rules back.
      const shortcutRules = shortcutRulesWithDefaults(
        partial.shortcutRules ?? persistedSettings.shortcutRules,
      )
      persistedSettings = {
        ...persistedSettings,
        ...partial,
        shortcutRules,
        shortcutBindings: shortcutBindingsFromRules(shortcutRules),
      }
      return { ok: true }
    })
    apiMock.getSettings.mockImplementation(async () => persistedSettings)
    apiMock.listExtensionContributions.mockResolvedValue({
      projectPaths: ['/repo'],
      entries: [sidePanelEntry()],
    })
  })

  it('lists built-in panels, extension panels by extension and remembered bindings', async () => {
    renderWithQueryClient(<ShortcutsSection />)
    await screen.findByRole('heading', { name: 'Acme Notes' })

    for (const label of [
      'All panels',
      'Changes',
      'Project Actions',
      'Browser',
      'Files',
      'Session Tree',
      'Resources',
      'Toggle right panel',
      'Notes',
    ]) {
      expect(panels().getByRole('article', { name: label })).toBeInTheDocument()
    }
    expect(panels().getByRole('button', { name: 'Change shortcut for Changes' })).toHaveTextContent(
      'Ctrl + D',
    )
    expect(panels().getByRole('button', { name: 'Change shortcut for Notes' })).toHaveTextContent(
      'Unassigned',
    )
    const remembered = panels().getByRole('article', { name: 'board' })
    expect(within(remembered).getByText('Not installed')).toBeInTheDocument()
    expect(panels().getByRole('heading', { name: 'Extensions not installed' })).toBeInTheDocument()
  })

  it('records an extension panel binding by stable surface id', async () => {
    renderWithQueryClient(<ShortcutsSection />)
    await screen.findByRole('heading', { name: 'Acme Notes' })

    record('Change shortcut for Notes', 'g', { shiftKey: true })
    fireEvent.click(within(panels().getByRole('article', { name: 'Notes' })).getByText('Save'))

    await waitFor(() =>
      expect(usePreferencesStore.getState().settings.extensionPanelShortcutBindings).toEqual({
        [REMOVED]: { key: 'K', mod: true, alt: true },
        [NOTES]: { key: 'G', mod: true, shift: true },
      }),
    )
  })

  it('blocks an extension panel binding that a built-in command uses', async () => {
    renderWithQueryClient(<ShortcutsSection />)
    await screen.findByRole('heading', { name: 'Acme Notes' })

    record('Change shortcut for Notes', 'd')
    const row = panels().getByRole('article', { name: 'Notes' })

    expect(within(row).getByRole('alert')).toHaveTextContent('Already used by “Toggle diff”')
    expect(within(row).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('forgets a remembered binding of an extension that is not installed', async () => {
    renderWithQueryClient(<ShortcutsSection />)
    await screen.findByRole('heading', { name: 'Acme Notes' })

    fireEvent.click(panels().getByRole('button', { name: 'Clear binding for board' }))

    await waitFor(() =>
      expect(apiMock.updateSettings).toHaveBeenCalledWith({ extensionPanelShortcutBindings: {} }),
    )
  })

  it('assigns and clears an optional built-in panel command', async () => {
    renderWithQueryClient(<ShortcutsSection />)
    await screen.findByRole('heading', { name: 'Acme Notes' })

    record('Change shortcut for Files', 'e', { shiftKey: true })
    fireEvent.click(within(panels().getByRole('article', { name: 'Files' })).getByText('Save'))

    await waitFor(() =>
      expect(usePreferencesStore.getState().settings.shortcutRules.at(-1)).toEqual({
        command: 'rightPanel.files',
        shortcut: { key: 'E', mod: true, shift: true },
        when: '!terminalFocus',
      }),
    )

    fireEvent.click(await panels().findByRole('button', { name: 'Clear binding for Files' }))
    await waitFor(() =>
      expect(
        usePreferencesStore
          .getState()
          .settings.shortcutRules.some((rule) => rule.command === 'rightPanel.files'),
      ).toBe(false),
    )
  })

  it('resets a remapped panel command to its default', async () => {
    renderWithQueryClient(<ShortcutsSection />)
    await screen.findByRole('heading', { name: 'Acme Notes' })

    record('Change shortcut for Changes', 'e', { shiftKey: true })
    fireEvent.click(within(panels().getByRole('article', { name: 'Changes' })).getByText('Save'))
    await waitFor(() =>
      expect(
        panels().getByRole('button', { name: 'Change shortcut for Changes' }),
      ).toHaveTextContent('Ctrl + Shift + E'),
    )
    fireEvent.click(panels().getByRole('button', { name: 'Reset Changes' }))

    await waitFor(() =>
      expect(
        usePreferencesStore
          .getState()
          .settings.shortcutRules.filter((rule) => rule.command === 'diff.toggle'),
      ).toEqual(DEFAULT_SHORTCUT_RULES.filter((rule) => rule.command === 'diff.toggle')),
    )
  })
})
