import type { ExtensionManagerView } from '@shared/types/extensions'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const {
  listExtensionPackagesMock,
  listExtensionContributionsMock,
  proposeExtensionPackageRemoveMock,
  applyExtensionPackageRemoveMock,
  showConfirmMock,
} = vi.hoisted(() => ({
  listExtensionPackagesMock: vi.fn(),
  listExtensionContributionsMock: vi.fn(),
  proposeExtensionPackageRemoveMock: vi.fn(),
  applyExtensionPackageRemoveMock: vi.fn(),
  showConfirmMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listExtensionPackages: listExtensionPackagesMock,
    listExtensionContributions: listExtensionContributionsMock,
    setExtensionTrusted: vi.fn(),
    setExtensionEnabled: vi.fn(),
    setExtensionProjectDisabled: vi.fn(),
    acceptExtensionUpdate: vi.fn(),
    approveExtensionBuild: vi.fn(),
    reloadExtension: vi.fn(),
    proposeExtensionPackageRemove: proposeExtensionPackageRemoveMock,
    applyExtensionPackageRemove: applyExtensionPackageRemoveMock,
    showConfirm: showConfirmMock,
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

const ENABLED_PACKAGE: ExtensionManagerView['packages'][number] = {
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
  lifecycle: {
    enabled: true,
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
  },
  projectOverride: { projectPath: '/tmp/project', disabled: false, updatedAt: null },
  projectOverrides: [{ projectPath: '/tmp/project', disabled: false, updatedAt: null }],
  diagnostics: [],
}

const ENABLED_VIEW: ExtensionManagerView = {
  projectPath: '/tmp/project',
  projectPaths: ['/tmp/project'],
  packages: [ENABLED_PACKAGE],
}

const EMPTY_VIEW: ExtensionManagerView = {
  projectPath: '/tmp/project',
  projectPaths: ['/tmp/project'],
  packages: [],
}

describe('ExtensionsSection remove workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listExtensionContributionsMock.mockResolvedValue({
      projectPaths: ['/tmp/project'],
      entries: [],
    })
    proposeExtensionPackageRemoveMock.mockResolvedValue({
      extensionId: 'sample-extension',
      scope: { kind: 'project', projectPath: '/tmp/project' },
      operation: 'remove',
      actor: { kind: 'user', userId: 'settings' },
      proposalHash: 'f'.repeat(64),
      requiresGlobalConfirmation: false,
      globalConfirmationRisk: null,
    })
    showConfirmMock.mockResolvedValue(true)
  })

  it('removes an extension package through the approved host workflow', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(ENABLED_VIEW)
    applyExtensionPackageRemoveMock.mockResolvedValueOnce(EMPTY_VIEW)

    renderWithQueryClient(<ExtensionsSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Sample Extension' }))

    await waitFor(() => {
      expect(proposeExtensionPackageRemoveMock).toHaveBeenCalledWith({
        extensionId: 'sample-extension',
        scope: { kind: 'project', projectPath: '/tmp/project' },
        viewProjectPaths: ['/tmp/project'],
        actor: { kind: 'user', userId: 'settings' },
      })
      expect(showConfirmMock).toHaveBeenCalledWith(
        'Remove Sample Extension?',
        expect.stringContaining('clears trust and enablement pins'),
      )
      expect(applyExtensionPackageRemoveMock).toHaveBeenCalledWith({
        extensionId: 'sample-extension',
        scope: { kind: 'project', projectPath: '/tmp/project' },
        viewProjectPaths: ['/tmp/project'],
        actor: { kind: 'user', userId: 'settings' },
        userApproval: {
          approved: true,
          approvedProposalHash: 'f'.repeat(64),
          approvedBy: 'settings',
          approvedAt: expect.any(Number),
        },
      })
    })
    await waitFor(() => {
      expect(screen.getAllByText('No extension packages in this scope.')).toHaveLength(2)
    })
  })
})
