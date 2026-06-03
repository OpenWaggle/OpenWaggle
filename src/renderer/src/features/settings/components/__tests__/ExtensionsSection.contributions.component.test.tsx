import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionManagerView,
} from '@shared/types/extensions'
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const { listExtensionPackagesMock, listContributionsMock } = vi.hoisted(() => ({
  listExtensionPackagesMock: vi.fn(),
  listContributionsMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listExtensionPackages: listExtensionPackagesMock,
    listExtensionContributions: listContributionsMock,
    setExtensionTrusted: vi.fn(),
    setExtensionEnabled: vi.fn(),
    setExtensionProjectDisabled: vi.fn(),
    acceptExtensionUpdate: vi.fn(),
    approveExtensionBuild: vi.fn(),
    reloadExtension: vi.fn(),
  },
}))

vi.mock('@/features/settings/hooks/useSettings', () => ({
  usePreferences: () => ({
    settings: {
      projectPath: '/tmp/project',
      recentProjects: [],
      projectDisplayNames: {},
    },
  }),
}))

vi.mock('@/features/sessions/hooks', () => ({
  useSessions: () => ({
    sessions: [],
  }),
}))

import { ExtensionsSection } from '../sections/ExtensionsSection'

const EMPTY_VIEW: ExtensionManagerView = {
  projectPath: '/tmp/project',
  projectPaths: ['/tmp/project'],
  packages: [],
}

const SAMPLE_PACKAGE: ExtensionManagerView['packages'][number] = {
  id: 'sample-extension',
  scope: {
    kind: 'project',
    label: 'Project',
    projectPath: '/tmp/project',
  },
  packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
  manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
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
  lifecycle: null,
  projectOverride: {
    projectPath: '/tmp/project',
    disabled: false,
    updatedAt: null,
  },
  projectOverrides: [
    {
      projectPath: '/tmp/project',
      disabled: false,
      updatedAt: null,
    },
  ],
  diagnostics: [],
}

const PACKAGE_VIEW: ExtensionManagerView = {
  projectPath: '/tmp/project',
  projectPaths: ['/tmp/project'],
  packages: [SAMPLE_PACKAGE],
}

const COMMAND_ENTRY: ExtensionContributionRegistryEntry = {
  extensionId: SAMPLE_PACKAGE.id,
  extensionName: 'Sample Extension',
  extensionVersion: '1.0.0',
  scope: SAMPLE_PACKAGE.scope,
  packagePath: SAMPLE_PACKAGE.packagePath,
  manifestPath: SAMPLE_PACKAGE.manifestPath,
  projectPaths: ['/tmp/project'],
  appliesToAllRequestedProjects: true,
  family: 'commands',
  contributionId: 'sample.run',
  title: 'Run sample',
  label: 'Run sample',
  category: 'Sample',
  capability: 'sample.invoke',
  eligibility: {
    runtimeEnabled: false,
    enabled: false,
    trusted: false,
    sdkCompatible: true,
    updateAvailable: false,
    disabledProjectPaths: [],
  },
  diagnostics: [],
}

const SETTINGS_ENTRY: ExtensionContributionRegistryEntry = {
  ...COMMAND_ENTRY,
  family: 'settingsSections',
  contributionId: 'sample.settings',
  title: 'Sample settings',
  label: 'Sample settings',
  lane: 'trusted-react',
  entryPath: 'dist/settings.js',
}

const EMPTY_REGISTRY: ExtensionContributionRegistryView = {
  projectPaths: ['/tmp/project'],
  entries: [],
}

const CONTRIBUTION_REGISTRY: ExtensionContributionRegistryView = {
  projectPaths: ['/tmp/project'],
  entries: [COMMAND_ENTRY, SETTINGS_ENTRY],
}

describe('ExtensionsSection contribution registry', () => {
  beforeEach(() => {
    listExtensionPackagesMock.mockReset()
    listContributionsMock.mockReset()
  })

  it('renders empty registry totals', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(EMPTY_VIEW)
    listContributionsMock.mockResolvedValueOnce(EMPTY_REGISTRY)

    renderWithQueryClient(<ExtensionsSection />)

    const summary = await screen.findByLabelText('Extension contribution summary')
    expect(within(summary).getByText('Registry contributions')).toBeInTheDocument()
    expect(within(summary).getByText('Families')).toBeInTheDocument()
    expect(within(summary).getByText('Packages')).toBeInTheDocument()
    expect(within(summary).getAllByText('0')).toHaveLength(3)
    expect(listContributionsMock).toHaveBeenCalledWith({ projectPaths: ['/tmp/project'] })
  })

  it('renders non-empty contribution summaries', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(PACKAGE_VIEW)
    listContributionsMock.mockResolvedValueOnce(CONTRIBUTION_REGISTRY)

    renderWithQueryClient(<ExtensionsSection />)

    expect(await screen.findByText('Sample Extension')).toBeInTheDocument()
    const summary = screen.getByLabelText('Extension contribution summary')
    expect(within(summary).getAllByText('2')).toHaveLength(2)
    expect(within(summary).getByText('1')).toBeInTheDocument()
    expect(screen.getByText('Commands 1')).toBeInTheDocument()
    expect(screen.getByText('Settings 1')).toBeInTheDocument()
  })
})
