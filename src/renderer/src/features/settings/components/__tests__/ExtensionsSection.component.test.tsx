import type { ExtensionManagerView } from '@shared/types/extensions'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const {
  listExtensionPackagesMock,
  setExtensionTrustedMock,
  setExtensionEnabledMock,
  setExtensionProjectDisabledMock,
  projectPathMock,
  sessionsMock,
} = vi.hoisted(() => ({
  listExtensionPackagesMock: vi.fn(),
  setExtensionTrustedMock: vi.fn(),
  setExtensionEnabledMock: vi.fn(),
  setExtensionProjectDisabledMock: vi.fn(),
  projectPathMock: { current: '/tmp/project' },
  sessionsMock: { current: [] },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listExtensionPackages: listExtensionPackagesMock,
    setExtensionTrusted: setExtensionTrustedMock,
    setExtensionEnabled: setExtensionEnabledMock,
    setExtensionProjectDisabled: setExtensionProjectDisabledMock,
    acceptExtensionUpdate: vi.fn(),
  },
}))

vi.mock('@/features/settings/hooks/useSettings', () => ({
  usePreferences: () => ({
    settings: {
      projectPath: projectPathMock.current,
      recentProjects: [],
      projectDisplayNames: {},
    },
  }),
}))

vi.mock('@/features/sessions/hooks', () => ({
  useSessions: () => ({
    sessions: sessionsMock.current,
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

const TRUSTED_LIFECYCLE: NonNullable<ExtensionManagerView['packages'][number]['lifecycle']> = {
  enabled: false,
  trusted: true,
  updateAvailable: false,
  grantedCapabilities: ['sample.invoke'],
  contentHash: '1234567890abcdef',
  packageVersion: '1.0.0',
  sdkRange: '>=0.1.0 <0.2.0',
  sdkCompatible: true,
  diagnostics: [],
  installedAt: 1000,
  updatedAt: 2000,
}
const PACKAGE_VIEW: ExtensionManagerView = {
  projectPath: '/tmp/project',
  projectPaths: ['/tmp/project'],
  packages: [SAMPLE_PACKAGE],
}
const TRUSTED_VIEW: ExtensionManagerView = {
  ...PACKAGE_VIEW,
  packages: [
    {
      ...SAMPLE_PACKAGE,
      lifecycle: TRUSTED_LIFECYCLE,
    },
  ],
}
const ENABLED_VIEW: ExtensionManagerView = {
  ...TRUSTED_VIEW,
  packages: [
    {
      ...SAMPLE_PACKAGE,
      lifecycle: {
        ...TRUSTED_LIFECYCLE,
        enabled: true,
      },
    },
  ],
}

const PROJECT_DISABLED_VIEW: ExtensionManagerView = {
  ...ENABLED_VIEW,
  packages: [
    {
      ...SAMPLE_PACKAGE,
      lifecycle: {
        ...TRUSTED_LIFECYCLE,
        enabled: false,
        grantedCapabilities: [],
      },
      projectOverride: {
        projectPath: '/tmp/project',
        disabled: true,
        updatedAt: 3000,
      },
      projectOverrides: [
        {
          projectPath: '/tmp/project',
          disabled: true,
          updatedAt: 3000,
        },
      ],
    },
  ],
}

describe('ExtensionsSection', () => {
  beforeEach(() => {
    listExtensionPackagesMock.mockReset()
    setExtensionTrustedMock.mockReset()
    setExtensionEnabledMock.mockReset()
    setExtensionProjectDisabledMock.mockReset()
    projectPathMock.current = '/tmp/project'
    sessionsMock.current = []
  })

  it('loads and renders discovered extension packages for the selected project', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(PACKAGE_VIEW)

    renderWithQueryClient(<ExtensionsSection />)

    expect(screen.getByText(/loading extensions/i)).toBeInTheDocument()
    expect(await screen.findByText('Sample Extension')).toBeInTheDocument()
    expect(screen.getByText('Untrusted')).toBeInTheDocument()
    expect(screen.getByText('Project active')).toBeInTheDocument()
    expect(screen.getByText('SDK compatible')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trust Sample Extension' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable Sample Extension' })).toBeDisabled()
    expect(listExtensionPackagesMock).toHaveBeenCalledWith({ projectPaths: ['/tmp/project'] })
  })

  it('renders the global scope when no extension packages are found', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(EMPTY_VIEW)

    renderWithQueryClient(<ExtensionsSection />)

    expect(await screen.findByText('Global scope')).toBeInTheDocument()
    expect(screen.getAllByText(/no extension packages in this scope/i)).toHaveLength(2)
  })

  it('refreshes the extension inventory on demand', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(EMPTY_VIEW).mockResolvedValueOnce(PACKAGE_VIEW)

    renderWithQueryClient(<ExtensionsSection />)
    await screen.findByText('Global scope')
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => {
      expect(listExtensionPackagesMock).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText('Sample Extension')).toBeInTheDocument()
  })

  it('shows a load error without crashing the settings surface', async () => {
    listExtensionPackagesMock.mockRejectedValueOnce(new Error('Discovery failed'))

    renderWithQueryClient(<ExtensionsSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Discovery failed')
    expect(screen.queryByText(/no extension packages discovered/i)).not.toBeInTheDocument()
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
