import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { usePreferencesStore } from '@/features/settings/state'
import { CommandPalette } from '../CommandPalette'

const PROJECT_PATH = '/tmp/project'

const { apiMock, navigateMock } = vi.hoisted(() => ({
  apiMock: {
    getProjectPreferences: vi.fn(),
    getSettings: vi.fn(),
    invokeExtension: vi.fn(),
    listExtensionContributions: vi.fn(),
    listWagglePresets: vi.fn(),
  },
  navigateMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

function renderWithQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <CommandPalette slashSkills={[]} onSelectSkill={vi.fn()} onStartWaggle={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('CommandPalette extension commands', () => {
  beforeEach(() => {
    apiMock.getProjectPreferences.mockReset()
    apiMock.getSettings.mockReset()
    apiMock.invokeExtension.mockReset()
    apiMock.listExtensionContributions.mockReset()
    apiMock.listWagglePresets.mockReset()
    navigateMock.mockReset()
    window.location.hash = ''
    apiMock.invokeExtension.mockResolvedValue({
      ok: true,
      value: {
        extensionId: 'sample-extension',
        contributionId: 'sample.run',
        capability: 'sample.execute',
        method: 'run',
        scope: { kind: 'project', projectPath: PROJECT_PATH },
        declaredScopes: ['project'],
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.run',
        capability: 'sample.execute',
        method: 'run',
        scope: { kind: 'project', projectPath: PROJECT_PATH },
        outcome: 'succeeded',
        timestamp: 1,
      },
    })
    apiMock.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, projectPath: PROJECT_PATH })
    apiMock.getProjectPreferences.mockResolvedValue(null)
    apiMock.listWagglePresets.mockResolvedValue([])
    useComposerStore.setState(useComposerStore.getInitialState())
    apiMock.listExtensionContributions.mockResolvedValue({
      projectPaths: [PROJECT_PATH],
      entries: [
        {
          extensionId: 'sample-extension',
          extensionName: 'Sample Extension',
          extensionVersion: '1.0.0',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' },
          packagePath: '/tmp/extensions/sample-extension',
          manifestPath: '/tmp/extensions/sample-extension/openwaggle.extension.json',
          contentHash: 'abcdef',
          projectPaths: [PROJECT_PATH],
          appliesToAllRequestedProjects: true,
          family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS,
          contributionId: 'sample.run',
          title: 'Run sample extension',
          label: 'Run sample extension',
          category: 'Sample',
          capability: 'sample.execute',
          method: 'run',
          declaredScopes: ['project'],
          eligibility: {
            runtimeEnabled: true,
            enabled: true,
            trusted: true,
            sdkCompatible: true,
            updateAvailable: false,
            disabledProjectPaths: [],
          },
          diagnostics: [],
        },
      ],
    })
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, projectPath: PROJECT_PATH },
      isLoaded: true,
      loadError: null,
    })
  })

  it('refreshes preferences after extension commands mutate OpenWaggle settings', async () => {
    const selectedProjectPath = '/tmp/other-project'
    apiMock.invokeExtension.mockResolvedValueOnce({
      ok: true,
      value: {
        extensionId: 'sample-extension',
        contributionId: 'sample.run',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
        previousProjectPath: PROJECT_PATH,
        projectPath: selectedProjectPath,
        recentProjects: [selectedProjectPath],
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.run',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
        scope: { kind: 'app' },
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
        timestamp: 1,
      },
    })
    apiMock.getSettings.mockResolvedValueOnce({
      ...DEFAULT_SETTINGS,
      projectPath: selectedProjectPath,
      recentProjects: [selectedProjectPath],
    })

    renderWithQueryClient()

    fireEvent.click(await screen.findByRole('button', { name: /run sample extension/i }))

    await waitFor(() => {
      expect(apiMock.getSettings).toHaveBeenCalledOnce()
    })
    expect(apiMock.getProjectPreferences).toHaveBeenCalledWith(selectedProjectPath)
    expect(usePreferencesStore.getState().settings.projectPath).toBe(selectedProjectPath)
  })

  it('routes extension command selections through the broker API', async () => {
    renderWithQueryClient()

    fireEvent.click(await screen.findByRole('button', { name: /run sample extension/i }))

    await waitFor(() => {
      expect(apiMock.invokeExtension).toHaveBeenCalledWith({
        extensionId: 'sample-extension',
        contributionId: 'sample.run',
        capability: 'sample.execute',
        method: 'run',
        scope: { kind: 'project', projectPath: PROJECT_PATH },
        payload: {},
      })
    })
  })

  it('uses app scope for app-only extension commands when a project is active', async () => {
    apiMock.listExtensionContributions.mockResolvedValueOnce({
      projectPaths: [PROJECT_PATH],
      entries: [
        {
          extensionId: 'sample-extension',
          extensionName: 'Sample Extension',
          extensionVersion: '1.0.0',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' },
          packagePath: '/tmp/extensions/sample-extension',
          manifestPath: '/tmp/extensions/sample-extension/openwaggle.extension.json',
          contentHash: 'abcdef',
          projectPaths: [PROJECT_PATH],
          appliesToAllRequestedProjects: true,
          family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS,
          contributionId: 'sample.app',
          title: 'Run app extension',
          label: 'Run app extension',
          category: 'Sample',
          capability: 'sample.execute',
          method: 'run',
          declaredScopes: ['app'],
          eligibility: {
            runtimeEnabled: true,
            enabled: true,
            trusted: true,
            sdkCompatible: true,
            updateAvailable: false,
            disabledProjectPaths: [],
          },
          diagnostics: [],
        },
      ],
    })

    renderWithQueryClient()

    fireEvent.click(await screen.findByRole('button', { name: /run app extension/i }))

    await waitFor(() => {
      expect(apiMock.invokeExtension).toHaveBeenCalledWith({
        extensionId: 'sample-extension',
        contributionId: 'sample.app',
        capability: 'sample.execute',
        method: 'run',
        scope: { kind: 'app' },
        payload: {},
      })
    })
  })

  it('lists extension slash commands and inserts slash text for composer submission', async () => {
    apiMock.listExtensionContributions.mockResolvedValueOnce({
      projectPaths: [PROJECT_PATH],
      entries: [
        {
          extensionId: 'sample-extension',
          extensionName: 'Sample Extension',
          extensionVersion: '1.0.0',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' },
          packagePath: '/tmp/extensions/sample-extension',
          manifestPath: '/tmp/extensions/sample-extension/openwaggle.extension.json',
          contentHash: 'abcdef',
          projectPaths: [PROJECT_PATH],
          appliesToAllRequestedProjects: true,
          family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SLASH_COMMANDS,
          contributionId: 'sample.slash',
          title: 'Run sample slash',
          label: 'Run sample slash',
          category: 'Sample',
          capability: 'sample.execute',
          method: 'run',
          eligibility: {
            runtimeEnabled: true,
            enabled: true,
            trusted: true,
            sdkCompatible: true,
            updateAvailable: false,
            disabledProjectPaths: [],
          },
          diagnostics: [],
        },
      ],
    })

    renderWithQueryClient()

    fireEvent.click(await screen.findByRole('button', { name: /run sample slash/i }))

    expect(useComposerStore.getState().input).toBe('/sample.slash ')
    expect(apiMock.invokeExtension).not.toHaveBeenCalled()
  })

  it('opens extension side panels through chat route search state', async () => {
    window.location.hash = '#/sessions/session-1?branch=branch-1&node=node-1'
    apiMock.listExtensionContributions.mockResolvedValueOnce({
      projectPaths: [PROJECT_PATH],
      entries: [
        {
          extensionId: 'sample-extension',
          extensionName: 'Sample Extension',
          extensionVersion: '1.0.0',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' },
          packagePath: '/tmp/extensions/sample-extension',
          manifestPath: '/tmp/extensions/sample-extension/openwaggle.extension.json',
          contentHash: 'abcdef',
          projectPaths: [PROJECT_PATH],
          appliesToAllRequestedProjects: true,
          family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
          contributionId: 'sample.panel',
          title: 'Open sample panel',
          label: 'Open sample panel',
          category: 'Sample',
          runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
          execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
          entryPath: 'modules/side-panel.js',
          eligibility: {
            runtimeEnabled: true,
            enabled: true,
            trusted: true,
            sdkCompatible: true,
            updateAvailable: false,
            disabledProjectPaths: [],
          },
          diagnostics: [],
        },
      ],
    })

    renderWithQueryClient()

    fireEvent.click(await screen.findByRole('button', { name: /open sample panel/i }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled()
    })
    const navigateInput = navigateMock.mock.calls[0]?.[0]
    expect(navigateInput).toMatchObject({
      to: '/sessions/$sessionId',
      params: { sessionId: 'session-1' },
    })
    expect(navigateInput.search({ branch: 'branch-1', node: 'node-1' })).toEqual({
      branch: 'branch-1',
      node: 'node-1',
      diff: undefined,
      panel: 'extension-side-panel',
      sidePanelExtensionId: 'sample-extension',
      sidePanelId: 'sample.panel',
      sidePanelPackagePath: '/tmp/extensions/sample-extension',
      sidePanelContentHash: 'abcdef',
    })
  })
})
