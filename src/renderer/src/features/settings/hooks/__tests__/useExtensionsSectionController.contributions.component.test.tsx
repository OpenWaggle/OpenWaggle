import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionManagerView,
  ExtensionPackageSummary,
} from '@shared/types/extensions'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderStore } from '@/features/providers/state'
import { usePreferencesStore } from '@/features/settings/state'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    listExtensionPackages: vi.fn(),
    listExtensionContributions: vi.fn(),
    setExtensionTrusted: vi.fn(),
    setExtensionEnabled: vi.fn(),
    setExtensionProjectDisabled: vi.fn(),
    acceptExtensionUpdate: vi.fn(),
    approveExtensionBuild: vi.fn(),
    reloadExtension: vi.fn(),
    proposeExtensionPackageRemove: vi.fn(),
    applyExtensionPackageRemove: vi.fn(),
    showConfirm: vi.fn(),
    getProviderModels: vi.fn(),
    updateSettings: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

import { useExtensionsSectionController } from '../useExtensionsSectionController'

const PROJECT_PATH = '/tmp/project'
const OTHER_PROJECT_PATH = '/tmp/other-project'

const SAMPLE_PACKAGE: ExtensionPackageSummary = {
  id: 'sample-extension',
  scope: { kind: 'project', label: 'Project', projectPath: PROJECT_PATH },
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
  projectOverride: { projectPath: PROJECT_PATH, disabled: false, updatedAt: null },
  projectOverrides: [{ projectPath: PROJECT_PATH, disabled: false, updatedAt: null }],
  diagnostics: [],
}

const ENABLED_VIEW: ExtensionManagerView = {
  projectPath: PROJECT_PATH,
  projectPaths: [PROJECT_PATH],
  packages: [SAMPLE_PACKAGE],
}

const REMOVED_VIEW: ExtensionManagerView = {
  projectPath: PROJECT_PATH,
  projectPaths: [PROJECT_PATH],
  packages: [],
}

const COMMAND_ENTRY: ExtensionContributionRegistryEntry = {
  extensionId: SAMPLE_PACKAGE.id,
  extensionName: 'Sample Extension',
  extensionVersion: '1.0.0',
  scope: SAMPLE_PACKAGE.scope,
  packagePath: SAMPLE_PACKAGE.packagePath,
  manifestPath: SAMPLE_PACKAGE.manifestPath,
  contentHash: 'abcdef',
  projectPaths: [PROJECT_PATH],
  appliesToAllRequestedProjects: true,
  family: 'commands',
  contributionId: 'sample.run',
  title: 'Run sample',
  label: 'Run sample',
  category: 'Sample',
  capability: 'sample.invoke',
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

const EMPTY_REGISTRY: ExtensionContributionRegistryView = {
  projectPaths: [PROJECT_PATH],
  entries: [],
}

const OTHER_PROJECT_REGISTRY: ExtensionContributionRegistryView = {
  projectPaths: [OTHER_PROJECT_PATH],
  entries: [],
}

const CONTRIBUTION_REGISTRY: ExtensionContributionRegistryView = {
  projectPaths: [PROJECT_PATH],
  entries: [COMMAND_ENTRY],
}

describe('useExtensionsSectionController contribution teardown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.listExtensionPackages.mockResolvedValue(ENABLED_VIEW)
    apiMock.listExtensionContributions.mockResolvedValue(EMPTY_REGISTRY)
    apiMock.setExtensionEnabled.mockResolvedValue(ENABLED_VIEW)
    apiMock.proposeExtensionPackageRemove.mockResolvedValue({
      extensionId: SAMPLE_PACKAGE.id,
      scope: SAMPLE_PACKAGE.scope,
      operation: 'remove',
      actor: { kind: 'user', userId: 'settings' },
      proposalHash: 'f'.repeat(64),
      requiresGlobalConfirmation: false,
      globalConfirmationRisk: null,
    })
    apiMock.applyExtensionPackageRemove.mockResolvedValue(REMOVED_VIEW)
    apiMock.showConfirm.mockResolvedValue(true)
    apiMock.getProviderModels.mockResolvedValue([])
    apiMock.updateSettings.mockResolvedValue(undefined)
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, projectPath: PROJECT_PATH },
      isLoaded: true,
      loadError: null,
    })
    useProviderStore.setState({ ...useProviderStore.getInitialState() })
  })

  it('exposes non-empty contribution summaries', async () => {
    apiMock.listExtensionContributions.mockResolvedValueOnce(CONTRIBUTION_REGISTRY)

    const { result } = renderHookWithQueryClient(() =>
      useExtensionsSectionController([PROJECT_PATH]),
    )

    await waitFor(() => {
      expect(result.current.contributionRegistry?.entries).toHaveLength(1)
    })
    expect(result.current.contributionRegistry?.entries[0]?.family).toBe('commands')
  })

  it('refreshes and invalidates contribution registries after disabling an extension', async () => {
    apiMock.listExtensionContributions.mockResolvedValueOnce(CONTRIBUTION_REGISTRY)
    const otherProjectContributionsKey = ['extensionContributions', OTHER_PROJECT_PATH] as const
    const { result, client } = renderHookWithQueryClient(() =>
      useExtensionsSectionController([PROJECT_PATH]),
    )
    client.setQueryData(otherProjectContributionsKey, OTHER_PROJECT_REGISTRY)

    await waitFor(() => {
      expect(result.current.contributionRegistry?.entries).toHaveLength(1)
    })

    await act(async () => {
      await result.current.setEnabled(SAMPLE_PACKAGE, false)
    })

    await waitFor(() => {
      expect(result.current.contributionRegistry).toEqual(EMPTY_REGISTRY)
    })
    expect(client.getQueryState(otherProjectContributionsKey)?.isInvalidated).toBe(true)
  })

  it('applies an approved remove workflow and refreshes contribution registry', async () => {
    apiMock.listExtensionContributions.mockResolvedValueOnce(CONTRIBUTION_REGISTRY)
    const { result } = renderHookWithQueryClient(() =>
      useExtensionsSectionController([PROJECT_PATH]),
    )

    await waitFor(() => {
      expect(result.current.contributionRegistry?.entries).toHaveLength(1)
    })

    await act(async () => {
      await result.current.remove(SAMPLE_PACKAGE)
    })

    await waitFor(() => {
      expect(result.current.contributionRegistry).toEqual(EMPTY_REGISTRY)
    })
    expect(apiMock.proposeExtensionPackageRemove).toHaveBeenCalledWith({
      extensionId: 'sample-extension',
      scope: { kind: 'project', projectPath: PROJECT_PATH },
      viewProjectPaths: [PROJECT_PATH],
      actor: { kind: 'user', userId: 'settings' },
    })
    expect(apiMock.showConfirm).toHaveBeenCalledWith(
      'Remove Sample Extension?',
      expect.stringContaining('deletes the extension package'),
    )
    expect(apiMock.applyExtensionPackageRemove).toHaveBeenCalledWith({
      extensionId: 'sample-extension',
      scope: { kind: 'project', projectPath: PROJECT_PATH },
      viewProjectPaths: [PROJECT_PATH],
      actor: { kind: 'user', userId: 'settings' },
      userApproval: {
        approved: true,
        approvedProposalHash: 'f'.repeat(64),
        approvedBy: 'settings',
        approvedAt: expect.any(Number),
      },
    })
    expect(apiMock.listExtensionContributions).toHaveBeenCalledTimes(2)
  })
})
