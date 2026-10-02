import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { extensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings'
import { registerRightPanelController } from '@/shared/lib/right-panel-surfaces'
import {
  getWorkspaceLifecycleMocks,
  loadUseWorkspaceLifecycle,
  resetWorkspaceLifecycleMocks,
  runWorkspaceHotkey,
} from './useWorkspaceLifecycle.test-harness'

const lifecycleMocks = getWorkspaceLifecycleMocks()
const NOTES = extensionRightPanelSurfaceId({ extensionId: 'acme.notes', sidePanelId: 'notes' })

function sidePanelEntry(
  overrides: Partial<ExtensionContributionRegistryEntry> = {},
): ExtensionContributionRegistryEntry {
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
    ...overrides,
  }
}

function bindNotesPanel() {
  const settings = usePreferencesStore.getState().settings
  usePreferencesStore.setState({
    settings: {
      ...settings,
      extensionPanelShortcutBindings: { [NOTES]: { key: 'G', mod: true, shift: true } },
    },
  })
}

describe('useWorkspaceLifecycle Right panel shortcuts', () => {
  let useWorkspaceLifecycle: Awaited<
    ReturnType<typeof loadUseWorkspaceLifecycle>
  >['useWorkspaceLifecycle']
  const controller = {
    toggleSurface: vi.fn(),
    showSurface: vi.fn(),
    togglePanel: vi.fn(),
    closePanel: vi.fn(),
  }
  let unregister: (() => void) | null = null

  beforeEach(async () => {
    resetWorkspaceLifecycleMocks()
    controller.toggleSurface.mockClear()
    controller.showSurface.mockClear()
    ;({ useWorkspaceLifecycle } = await loadUseWorkspaceLifecycle())
  })

  afterEach(() => {
    unregister?.()
    unregister = null
  })

  it('routes built-in panel shortcuts through the Right panel controller when one is registered', () => {
    unregister = registerRightPanelController(controller)
    renderHook(() => useWorkspaceLifecycle())

    act(() => runWorkspaceHotkey('Mod+D'))
    act(() => runWorkspaceHotkey('Mod+Shift+Y'))
    act(() => runWorkspaceHotkey('Mod+Shift+J'))

    expect(controller.toggleSurface.mock.calls).toEqual([
      ['changes'],
      ['session-tree'],
      ['browser'],
    ])
    expect(lifecycleMocks.toggleDiff).not.toHaveBeenCalled()
    expect(lifecycleMocks.toggleSessionTree).not.toHaveBeenCalled()
  })

  it('keeps the legacy panel toggles while no controller is registered', () => {
    renderHook(() => useWorkspaceLifecycle())

    act(() => runWorkspaceHotkey('Mod+D'))
    act(() => runWorkspaceHotkey('Mod+Shift+Y'))

    expect(lifecycleMocks.toggleDiff).toHaveBeenCalledOnce()
    expect(lifecycleMocks.toggleSessionTree).toHaveBeenCalledOnce()
  })

  it('toggles an available extension side panel from its user binding', () => {
    unregister = registerRightPanelController(controller)
    lifecycleMocks.extensionRegistry = { projectPaths: ['/repo'], entries: [sidePanelEntry()] }
    bindNotesPanel()
    renderHook(() => useWorkspaceLifecycle())

    const press = new KeyboardEvent('keydown', {
      key: 'g',
      code: 'KeyG',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(press))

    expect(controller.toggleSurface).toHaveBeenCalledWith(NOTES)
    expect(press.defaultPrevented).toBe(true)
  })

  it('ignores the binding while the panel is unavailable and lets the key through', () => {
    unregister = registerRightPanelController(controller)
    lifecycleMocks.extensionRegistry = {
      projectPaths: ['/repo'],
      entries: [
        sidePanelEntry({
          eligibility: { ...sidePanelEntry().eligibility, trusted: false },
        }),
      ],
    }
    bindNotesPanel()
    renderHook(() => useWorkspaceLifecycle())

    const press = new KeyboardEvent('keydown', {
      key: 'g',
      code: 'KeyG',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => window.dispatchEvent(press))

    expect(controller.toggleSurface).not.toHaveBeenCalled()
    expect(press.defaultPrevented).toBe(false)
  })

  it('ignores the binding when the extension is not installed', () => {
    unregister = registerRightPanelController(controller)
    lifecycleMocks.extensionRegistry = { projectPaths: ['/repo'], entries: [] }
    bindNotesPanel()
    renderHook(() => useWorkspaceLifecycle())

    act(() => runWorkspaceHotkey('Mod+Shift+G'))

    expect(controller.toggleSurface).not.toHaveBeenCalled()
  })
})
