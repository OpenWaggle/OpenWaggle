import { SupportedModelId } from '@shared/types/brand'
import type { ExtensionManagerView, ExtensionPackageSummary } from '@shared/types/extensions'
import type { ProviderInfo } from '@shared/types/llm'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    listExtensionPackages: vi.fn(),
    setExtensionTrusted: vi.fn(),
    setExtensionEnabled: vi.fn(),
    setExtensionProjectDisabled: vi.fn(),
    acceptExtensionUpdate: vi.fn(),
    approveExtensionBuild: vi.fn(),
    reloadExtension: vi.fn(),
    getSettings: vi.fn(),
    getProviderModels: vi.fn(),
    updateSettings: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

import { useExtensionsSectionController } from '../useExtensionsSectionController'

const PROJECT_PATH = '/tmp/project'
const OLD_MODEL = SupportedModelId('extension-provider/old-model')
const NEW_MODEL = SupportedModelId('extension-provider/new-model')

const SETTINGS_WITH_STALE_MODEL = {
  ...DEFAULT_SETTINGS,
  projectPath: PROJECT_PATH,
  enabledModels: [OLD_MODEL],
  selectedModel: OLD_MODEL,
} satisfies typeof DEFAULT_SETTINGS

const EXTENSION_PROVIDER_MODELS = [
  {
    provider: 'extension-provider',
    displayName: 'Extension Provider',
    auth: {
      configured: true,
      source: 'environment-or-custom',
      apiKeyConfigured: false,
      apiKeySource: 'none',
      oauthConnected: false,
      supportsApiKey: false,
      supportsOAuth: false,
    },
    models: [
      {
        id: NEW_MODEL,
        modelId: 'new-model',
        name: 'New Model',
        provider: 'extension-provider',
        available: true,
        availableThinkingLevels: ['medium'],
      },
    ],
  },
] satisfies ProviderInfo[]

const SAMPLE_PACKAGE: ExtensionPackageSummary = {
  id: 'sample-extension',
  scope: {
    kind: 'project',
    label: 'Project',
    projectPath: PROJECT_PATH,
  },
  packagePath: `${PROJECT_PATH}/.openwaggle/extensions/sample-extension`,
  manifestPath: `${PROJECT_PATH}/.openwaggle/extensions/sample-extension/openwaggle.extension.json`,
  manifest: {
    id: 'sample-extension',
    name: 'Sample Extension',
    version: '1.0.0',
    sdkRange: '>=0.1.0 <0.2.0',
    sourceFileCount: 1,
    builtArtifactCount: 1,
    capabilityCount: 1,
    contributionCount: 2,
    piResourceRootCount: 0,
    trustedMain: false,
    trustedRenderer: false,
    runtimeRequirementCount: 0,
  },
  buildPlan: null,
  contentHash: '1234567890abcdef',
  sdkCompatibility: {
    hostVersion: '0.1.0',
    requiredRange: '>=0.1.0 <0.2.0',
    compatible: true,
  },
  lifecycle: {
    enabled: true,
    trusted: true,
    updateAvailable: false,
    grantedCapabilities: ['provider.models'],
    contentHash: '1234567890abcdef',
    packageVersion: '1.0.0',
    approvedBuildPlanHash: null,
    buildStatus: 'not-run',
    buildLog: null,
    reloadStatus: 'not-reloaded',
    lastReloadedAt: null,
    sdkRange: '>=0.1.0 <0.2.0',
    sdkCompatible: true,
    diagnostics: [],
    installedAt: 1000,
    updatedAt: 2000,
  },
  projectOverride: {
    projectPath: PROJECT_PATH,
    disabled: false,
    updatedAt: null,
  },
  projectOverrides: [
    {
      projectPath: PROJECT_PATH,
      disabled: false,
      updatedAt: null,
    },
  ],
  diagnostics: [],
}

const ENABLED_VIEW: ExtensionManagerView = {
  projectPath: PROJECT_PATH,
  projectPaths: [PROJECT_PATH],
  packages: [SAMPLE_PACKAGE],
}

describe('useExtensionsSectionController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.listExtensionPackages.mockResolvedValue(ENABLED_VIEW)
    apiMock.setExtensionEnabled.mockResolvedValue(ENABLED_VIEW)
    apiMock.reloadExtension.mockResolvedValue(ENABLED_VIEW)
    apiMock.getSettings.mockResolvedValue(SETTINGS_WITH_STALE_MODEL)
    apiMock.getProviderModels.mockResolvedValue(EXTENSION_PROVIDER_MODELS)
    apiMock.updateSettings.mockResolvedValue(undefined)
    usePreferencesStore.setState({
      settings: SETTINGS_WITH_STALE_MODEL,
      isLoaded: true,
      loadError: null,
    })
    useProviderStore.setState({
      ...useProviderStore.getInitialState(),
    })
  })

  it('refreshes provider models after enabling an extension', async () => {
    const { result } = renderHookWithQueryClient(() =>
      useExtensionsSectionController([PROJECT_PATH]),
    )

    await act(async () => {
      await result.current.setEnabled(SAMPLE_PACKAGE, true)
    })

    expect(apiMock.setExtensionEnabled).toHaveBeenCalledWith({
      extensionId: 'sample-extension',
      scope: { kind: 'project', projectPath: PROJECT_PATH },
      viewProjectPaths: [PROJECT_PATH],
      enabled: true,
    })
    expect(apiMock.getProviderModels).toHaveBeenCalledWith(PROJECT_PATH)
    expect(apiMock.getSettings).not.toHaveBeenCalled()
    expect(useProviderStore.getState().providerModels).toEqual(EXTENSION_PROVIDER_MODELS)
    expect(apiMock.updateSettings).toHaveBeenCalledWith({
      enabledModels: [],
      selectedModel: DEFAULT_SETTINGS.selectedModel,
    })
    expect(usePreferencesStore.getState().settings.enabledModels).toEqual([])
    expect(usePreferencesStore.getState().settings.selectedModel).toBe(
      DEFAULT_SETTINGS.selectedModel,
    )
  })

  it('refreshes provider models after reloading an extension', async () => {
    const { result } = renderHookWithQueryClient(() =>
      useExtensionsSectionController([PROJECT_PATH]),
    )

    await act(async () => {
      await result.current.reload(SAMPLE_PACKAGE)
    })

    expect(apiMock.reloadExtension).toHaveBeenCalledWith({
      extensionId: 'sample-extension',
      scope: { kind: 'project', projectPath: PROJECT_PATH },
      viewProjectPaths: [PROJECT_PATH],
    })
    expect(apiMock.getProviderModels).toHaveBeenCalledWith(PROJECT_PATH)
    expect(useProviderStore.getState().providerModels).toEqual(EXTENSION_PROVIDER_MODELS)
  })
})
