import type { ExtensionManagerView } from '@shared/types/extensions'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const { listExtensionPackagesMock, approveExtensionBuildMock } = vi.hoisted(() => ({
  listExtensionPackagesMock: vi.fn(),
  approveExtensionBuildMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listExtensionPackages: listExtensionPackagesMock,
    setExtensionTrusted: vi.fn(),
    setExtensionEnabled: vi.fn(),
    setExtensionProjectDisabled: vi.fn(),
    acceptExtensionUpdate: vi.fn(),
    approveExtensionBuild: approveExtensionBuildMock,
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

const LOCAL_BUILD_PACKAGE: ExtensionManagerView['packages'][number] = {
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
  buildPlan: {
    installSource: 'local-build',
    command: 'pnpm build',
    outputCount: 1,
    approvalRequired: true,
    approved: false,
    inputHash: 'build-plan-hash',
  },
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

const LOCAL_BUILD_VIEW: ExtensionManagerView = {
  projectPath: '/tmp/project',
  projectPaths: ['/tmp/project'],
  packages: [LOCAL_BUILD_PACKAGE],
}

const BUILD_APPROVED_VIEW: ExtensionManagerView = {
  ...LOCAL_BUILD_VIEW,
  packages: [
    {
      ...LOCAL_BUILD_PACKAGE,
      buildPlan: {
        installSource: 'local-build',
        command: 'pnpm build',
        outputCount: 1,
        approvalRequired: true,
        approved: true,
        inputHash: 'build-plan-hash',
      },
      lifecycle: {
        enabled: false,
        trusted: false,
        updateAvailable: false,
        grantedCapabilities: [],
        contentHash: null,
        packageVersion: null,
        approvedBuildPlanHash: 'build-plan-hash',
        buildStatus: 'succeeded',
        buildLog: null,
        reloadStatus: 'not-reloaded',
        lastReloadedAt: null,
        sdkRange: '>=0.1.0 <0.2.0',
        sdkCompatible: true,
        diagnostics: [],
        installedAt: 1000,
        updatedAt: 2000,
      },
    },
  ],
}

const BUILD_FAILED_VIEW: ExtensionManagerView = {
  ...LOCAL_BUILD_VIEW,
  packages: [
    {
      ...LOCAL_BUILD_PACKAGE,
      lifecycle: {
        enabled: false,
        trusted: false,
        updateAvailable: false,
        grantedCapabilities: [],
        contentHash: null,
        packageVersion: null,
        approvedBuildPlanHash: 'build-plan-hash',
        buildStatus: 'failed',
        buildLog: 'stderr: missing artifact',
        reloadStatus: 'not-reloaded',
        lastReloadedAt: null,
        sdkRange: '>=0.1.0 <0.2.0',
        sdkCompatible: true,
        diagnostics: [
          {
            severity: 'error',
            code: 'build-failed',
            message: 'Build command failed with exit code 1.',
          },
        ],
        installedAt: 1000,
        updatedAt: 2000,
      },
      diagnostics: [
        {
          severity: 'error',
          code: 'build-failed',
          message: 'Build command failed with exit code 1.',
        },
      ],
    },
  ],
}

describe('ExtensionsSection build approval', () => {
  beforeEach(() => {
    listExtensionPackagesMock.mockReset()
    approveExtensionBuildMock.mockReset()
  })

  it('approves a local-build plan from settings', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(LOCAL_BUILD_VIEW)
    approveExtensionBuildMock.mockResolvedValueOnce(BUILD_APPROVED_VIEW)

    renderWithQueryClient(<ExtensionsSection />)

    expect(await screen.findByText('Build approval required')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve and build Sample Extension' }))

    await waitFor(() => {
      expect(approveExtensionBuildMock).toHaveBeenCalledWith({
        extensionId: 'sample-extension',
        scope: { kind: 'project', projectPath: '/tmp/project' },
        viewProjectPaths: ['/tmp/project'],
      })
    })
    expect(await screen.findByText('Build succeeded')).toBeInTheDocument()
  })

  it('renders failed build state returned by the build approval mutation', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(LOCAL_BUILD_VIEW)
    approveExtensionBuildMock.mockResolvedValueOnce(BUILD_FAILED_VIEW)

    renderWithQueryClient(<ExtensionsSection />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Approve and build Sample Extension' }),
    )

    expect(await screen.findByText('Build failed')).toBeInTheDocument()
    expect(screen.getByText('stderr: missing artifact')).toBeInTheDocument()
  })
})
