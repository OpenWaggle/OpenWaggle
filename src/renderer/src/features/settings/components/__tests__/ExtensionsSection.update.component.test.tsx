import type { ExtensionManagerView } from '@shared/types/extensions'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const { listExtensionPackagesMock, setExtensionTrustedMock, acceptExtensionUpdateMock } =
  vi.hoisted(() => ({
    listExtensionPackagesMock: vi.fn(),
    setExtensionTrustedMock: vi.fn(),
    acceptExtensionUpdateMock: vi.fn(),
  }))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listExtensionPackages: listExtensionPackagesMock,
    setExtensionTrusted: setExtensionTrustedMock,
    setExtensionEnabled: vi.fn(),
    setExtensionProjectDisabled: vi.fn(),
    acceptExtensionUpdate: acceptExtensionUpdateMock,
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

const TRUSTED_HASH = '1234567890abcdef'
const UPDATED_HASH = 'fedcba0987654321'

const samplePackage: ExtensionManagerView['packages'][number] = {
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
    version: '1.1.0',
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
  contentHash: UPDATED_HASH,
  sdkCompatibility: {
    hostVersion: '0.1.0',
    requiredRange: '>=0.1.0 <0.2.0',
    compatible: true,
  },
  lifecycle: {
    enabled: false,
    trusted: false,
    updateAvailable: true,
    grantedCapabilities: [],
    contentHash: TRUSTED_HASH,
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

const UPDATE_AVAILABLE_VIEW: ExtensionManagerView = {
  projectPath: '/tmp/project',
  projectPaths: ['/tmp/project'],
  packages: [samplePackage],
}

const UPDATE_APPROVED_VIEW: ExtensionManagerView = {
  ...UPDATE_AVAILABLE_VIEW,
  packages: [
    {
      ...samplePackage,
      lifecycle: samplePackage.lifecycle
        ? {
            ...samplePackage.lifecycle,
            trusted: true,
            updateAvailable: false,
            contentHash: UPDATED_HASH,
            packageVersion: '1.1.0',
          }
        : null,
    },
  ],
}

describe('ExtensionsSection update lifecycle', () => {
  beforeEach(() => {
    listExtensionPackagesMock.mockReset()
    setExtensionTrustedMock.mockReset()
    acceptExtensionUpdateMock.mockReset()
  })

  it('approves an explicit extension update from settings', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(UPDATE_AVAILABLE_VIEW)
    acceptExtensionUpdateMock.mockResolvedValueOnce(UPDATE_APPROVED_VIEW)

    renderWithQueryClient(<ExtensionsSection />)

    expect(await screen.findByText('Update available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Untrust Sample Extension' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve update Sample Extension' }))

    await waitFor(() => {
      expect(acceptExtensionUpdateMock).toHaveBeenCalledWith({
        extensionId: 'sample-extension',
        scope: { kind: 'project', projectPath: '/tmp/project' },
        viewProjectPaths: ['/tmp/project'],
      })
    })
    expect(setExtensionTrustedMock).not.toHaveBeenCalled()
    expect(await screen.findByText('Trusted')).toBeInTheDocument()
    expect(screen.queryByText('Update available')).not.toBeInTheDocument()
  })
})
