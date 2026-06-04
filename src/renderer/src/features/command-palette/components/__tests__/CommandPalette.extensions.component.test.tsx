import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { usePreferencesStore } from '@/features/settings/state'
import { CommandPalette } from '../CommandPalette'

const PROJECT_PATH = '/tmp/project'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    invokeExtension: vi.fn(),
    listExtensionContributions: vi.fn(),
    listWagglePresets: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
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
    apiMock.invokeExtension.mockReset()
    apiMock.listExtensionContributions.mockReset()
    apiMock.listWagglePresets.mockReset()
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
          projectPaths: [PROJECT_PATH],
          appliesToAllRequestedProjects: true,
          family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS,
          contributionId: 'sample.run',
          title: 'Run sample extension',
          label: 'Run sample extension',
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
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, projectPath: PROJECT_PATH },
      isLoaded: true,
      loadError: null,
    })
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
})
