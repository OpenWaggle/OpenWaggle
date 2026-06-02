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
    setExtensionTrusted: vi.fn(),
    setExtensionEnabled: vi.fn(),
    setExtensionProjectDisabled: vi.fn(),
    acceptExtensionUpdate: vi.fn(),
  },
}))

vi.mock('@/features/settings/hooks/useSettings', () => ({
  usePreferences: () => ({
    settings: {
      projectPath: '/tmp/project',
      recentProjects: ['/tmp/other-project', '/tmp/project'],
      projectDisplayNames: {},
    },
  }),
}))

vi.mock('@/features/sessions/hooks', () => ({
  useSessions: () => ({
    sessions: [{ projectPath: '/tmp/session-project' }],
  }),
}))

import { ExtensionsSection } from '../sections/ExtensionsSection'

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

const otherProjectPackage: ExtensionManagerView['packages'][number] = {
  ...samplePackage,
  id: 'other-extension',
  scope: {
    kind: 'project',
    label: 'Project',
    projectPath: '/tmp/other-project',
  },
  packagePath: '/tmp/other-project/.openwaggle/extensions/other-extension',
  manifestPath:
    '/tmp/other-project/.openwaggle/extensions/other-extension/openwaggle.extension.json',
  manifest: samplePackage.manifest
    ? {
        ...samplePackage.manifest,
        id: 'other-extension',
        name: 'Other Extension',
      }
    : null,
  projectOverride: {
    projectPath: '/tmp/other-project',
    disabled: false,
    updatedAt: null,
  },
  projectOverrides: [
    {
      projectPath: '/tmp/other-project',
      disabled: false,
      updatedAt: null,
    },
  ],
}

describe('ExtensionsSection scope inventory', () => {
  beforeEach(() => {
    listExtensionPackagesMock.mockReset()
  })

  it('loads selected and recent project scopes together', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce({
      projectPath: '/tmp/project',
      projectPaths: ['/tmp/project', '/tmp/other-project', '/tmp/session-project'],
      packages: [samplePackage, otherProjectPackage],
    } satisfies ExtensionManagerView)

    renderWithQueryClient(<ExtensionsSection />)

    expect(await screen.findByText('Sample Extension')).toBeInTheDocument()
    expect(screen.getByText('Other Extension')).toBeInTheDocument()
    expect(screen.getByText('project')).toBeInTheDocument()
    expect(screen.getByText('other-project')).toBeInTheDocument()
    expect(screen.getByText('session-project')).toBeInTheDocument()
    expect(listExtensionPackagesMock).toHaveBeenCalledWith({
      projectPaths: ['/tmp/project', '/tmp/other-project', '/tmp/session-project'],
    })
  })
})
