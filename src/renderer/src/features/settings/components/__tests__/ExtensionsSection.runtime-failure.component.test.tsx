import type { ExtensionManagerView } from '@shared/types/extensions'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const { listExtensionPackagesMock } = vi.hoisted(() => ({
  listExtensionPackagesMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listExtensionPackages: listExtensionPackagesMock,
    listExtensionContributions: vi.fn().mockResolvedValue({
      projectPaths: ['/tmp/project'],
      entries: [],
    }),
    setExtensionTrusted: vi.fn(),
    setExtensionEnabled: vi.fn(),
    setExtensionProjectDisabled: vi.fn(),
    acceptExtensionUpdate: vi.fn(),
    approveExtensionBuild: vi.fn(),
    reloadExtension: vi.fn(),
    proposeExtensionPackageRemove: vi.fn(),
    applyExtensionPackageRemove: vi.fn(),
    showConfirm: vi.fn(),
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
  useSessions: () => ({ sessions: [] }),
}))

import { ExtensionsSection } from '../sections/ExtensionsSection'

const RUNTIME_FAILED_VIEW: ExtensionManagerView = {
  projectPath: '/tmp/project',
  projectPaths: ['/tmp/project'],
  packages: [
    {
      id: 'sample-extension',
      scope: { kind: 'project', label: 'Project', projectPath: '/tmp/project' },
      packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
      manifestPath:
        '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
      manifest: {
        id: 'sample-extension',
        name: 'Sample Extension',
        version: '1.0.0',
        sdkRange: '>=0.1.0 <0.2.0',
        sourceFileCount: 1,
        builtArtifactCount: 1,
        capabilityCount: 1,
        contributionCount: 0,
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
        enabled: false,
        trusted: true,
        updateAvailable: false,
        grantedCapabilities: [],
        contentHash: '1234567890abcdef',
        packageVersion: '1.0.0',
        approvedBuildPlanHash: null,
        buildStatus: 'not-run',
        buildLog: null,
        reloadStatus: 'failed',
        lastReloadedAt: null,
        sdkRange: '>=0.1.0 <0.2.0',
        sdkCompatible: true,
        diagnostics: [
          {
            severity: 'error',
            code: 'runtime-load-failed',
            message: 'Extension runtime loading failed and the extension was disabled.',
          },
        ],
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
    },
  ],
}

describe('ExtensionsSection runtime failure diagnostics', () => {
  beforeEach(() => {
    listExtensionPackagesMock.mockReset()
  })

  it('renders lifecycle diagnostics from runtime activation failures', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(RUNTIME_FAILED_VIEW)

    renderWithQueryClient(<ExtensionsSection />)

    expect(await screen.findByText('Reload failed')).toBeInTheDocument()
    expect(screen.getByText('runtime-load-failed')).toBeInTheDocument()
    expect(
      screen.getByText(': Extension runtime loading failed and the extension was disabled.'),
    ).toBeInTheDocument()
  })
})
