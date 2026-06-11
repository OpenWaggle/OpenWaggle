import type { ExtensionManagerView } from '@shared/types/extensions'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const {
  listExtensionPackagesMock,
  listExtensionContributionsMock,
  setExtensionTrustedMock,
  setExtensionEnabledMock,
  setExtensionProjectDisabledMock,
  reloadExtensionMock,
} = vi.hoisted(() => ({
  listExtensionPackagesMock: vi.fn(),
  listExtensionContributionsMock: vi.fn(),
  setExtensionTrustedMock: vi.fn(),
  setExtensionEnabledMock: vi.fn(),
  setExtensionProjectDisabledMock: vi.fn(),
  reloadExtensionMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listExtensionPackages: listExtensionPackagesMock,
    listExtensionContributions: listExtensionContributionsMock,
    setExtensionTrusted: setExtensionTrustedMock,
    setExtensionEnabled: setExtensionEnabledMock,
    setExtensionProjectDisabled: setExtensionProjectDisabledMock,
    acceptExtensionUpdate: vi.fn(),
    approveExtensionBuild: vi.fn(),
    reloadExtension: reloadExtensionMock,
    proposeExtensionPackageRemove: vi.fn(),
    applyExtensionPackageRemove: vi.fn(),
    showConfirm: vi.fn(),
    getProviderModels: vi.fn().mockResolvedValue([]),
    updateSettings: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/features/settings/hooks/useSettings', () => ({
  usePreferences: () => ({
    settings: { projectPath: '/tmp/project', recentProjects: [], projectDisplayNames: {} },
  }),
}))

vi.mock('@/features/sessions/hooks', () => ({
  useSessions: () => ({ sessions: [] }),
}))

import { ExtensionsSection } from '../sections/ExtensionsSection'

type PackageLifecycle = NonNullable<ExtensionManagerView['packages'][number]['lifecycle']>

const SAMPLE_PACKAGE: ExtensionManagerView['packages'][number] = {
  id: 'sample-extension',
  scope: { kind: 'project', label: 'Project', projectPath: '/tmp/project' },
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
  projectOverride: { projectPath: '/tmp/project', disabled: false, updatedAt: null },
  projectOverrides: [{ projectPath: '/tmp/project', disabled: false, updatedAt: null }],
  diagnostics: [],
}

const TRUSTED_LIFECYCLE: PackageLifecycle = {
  enabled: false,
  trusted: true,
  updateAvailable: false,
  grantedCapabilities: ['sample.invoke'],
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
}

function viewWithPackage(
  packageView: ExtensionManagerView['packages'][number],
): ExtensionManagerView {
  return { projectPath: '/tmp/project', projectPaths: ['/tmp/project'], packages: [packageView] }
}

function packageWithLifecycle(
  lifecycle: PackageLifecycle,
): ExtensionManagerView['packages'][number] {
  return { ...SAMPLE_PACKAGE, lifecycle }
}

const PACKAGE_VIEW = viewWithPackage(SAMPLE_PACKAGE)
const TRUSTED_VIEW = viewWithPackage(packageWithLifecycle(TRUSTED_LIFECYCLE))
const ENABLED_VIEW = viewWithPackage(packageWithLifecycle({ ...TRUSTED_LIFECYCLE, enabled: true }))
const RELOADED_VIEW = viewWithPackage(
  packageWithLifecycle({
    ...TRUSTED_LIFECYCLE,
    enabled: true,
    reloadStatus: 'succeeded',
    lastReloadedAt: 2000,
  }),
)
const PROJECT_DISABLED_VIEW = viewWithPackage({
  ...SAMPLE_PACKAGE,
  lifecycle: { ...TRUSTED_LIFECYCLE, enabled: false, grantedCapabilities: [] },
  projectOverride: { projectPath: '/tmp/project', disabled: true, updatedAt: 3000 },
  projectOverrides: [{ projectPath: '/tmp/project', disabled: true, updatedAt: 3000 }],
})

describe('ExtensionsSection lifecycle controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listExtensionContributionsMock.mockResolvedValue({
      projectPaths: ['/tmp/project'],
      entries: [],
    })
  })

  it('trusts a discovered extension package from settings', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(PACKAGE_VIEW)
    setExtensionTrustedMock.mockResolvedValueOnce(TRUSTED_VIEW)

    renderWithQueryClient(<ExtensionsSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trust Sample Extension' }))

    await waitFor(() => {
      expect(setExtensionTrustedMock).toHaveBeenCalledWith({
        extensionId: 'sample-extension',
        scope: { kind: 'project', projectPath: '/tmp/project' },
        viewProjectPaths: ['/tmp/project'],
        trusted: true,
      })
    })
    expect(await screen.findByText('Trusted')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable Sample Extension' })).toBeEnabled()
  })

  it('shows a mutation error without leaking a rejected click promise', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(PACKAGE_VIEW)
    setExtensionTrustedMock.mockRejectedValueOnce(new Error('Trust failed'))

    renderWithQueryClient(<ExtensionsSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Trust Sample Extension' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Trust failed')
    expect(screen.getByRole('button', { name: 'Trust Sample Extension' })).toBeInTheDocument()
  })

  it('enables a trusted extension package from settings', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(TRUSTED_VIEW)
    setExtensionEnabledMock.mockResolvedValueOnce(ENABLED_VIEW)

    renderWithQueryClient(<ExtensionsSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Enable Sample Extension' }))

    await waitFor(() => {
      expect(setExtensionEnabledMock).toHaveBeenCalledWith({
        extensionId: 'sample-extension',
        scope: { kind: 'project', projectPath: '/tmp/project' },
        viewProjectPaths: ['/tmp/project'],
        enabled: true,
      })
    })
    expect(await screen.findByText('Enabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disable Sample Extension' })).toBeInTheDocument()
  })

  it('reloads an enabled extension package from settings', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(ENABLED_VIEW)
    reloadExtensionMock.mockResolvedValueOnce(RELOADED_VIEW)

    renderWithQueryClient(<ExtensionsSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reload Sample Extension' }))

    await waitFor(() => {
      expect(reloadExtensionMock).toHaveBeenCalledWith({
        extensionId: 'sample-extension',
        scope: { kind: 'project', projectPath: '/tmp/project' },
        viewProjectPaths: ['/tmp/project'],
      })
    })
    expect(await screen.findByText('Reloaded')).toBeInTheDocument()
    expect(screen.getByText('1970-01-01T00:00:02.000Z')).toBeInTheDocument()
  })

  it('disables an extension only for the selected project', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(ENABLED_VIEW)
    setExtensionProjectDisabledMock.mockResolvedValueOnce(PROJECT_DISABLED_VIEW)

    renderWithQueryClient(<ExtensionsSection />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Disable for project Sample Extension' }),
    )

    await waitFor(() => {
      expect(setExtensionProjectDisabledMock).toHaveBeenCalledWith({
        extensionId: 'sample-extension',
        scope: { kind: 'project', projectPath: '/tmp/project' },
        viewProjectPaths: ['/tmp/project'],
        projectPath: '/tmp/project',
        disabled: true,
      })
    })
    expect(await screen.findByText('Project disabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable Sample Extension' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Enable for project Sample Extension' }),
    ).toBeInTheDocument()
  })
})
