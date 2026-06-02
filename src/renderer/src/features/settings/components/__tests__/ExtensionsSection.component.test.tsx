import type { ExtensionManagerView } from '@shared/types/extensions'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const {
  listExtensionPackagesMock,
  setExtensionTrustedMock,
  setExtensionEnabledMock,
  projectPathMock,
} = vi.hoisted(() => ({
  listExtensionPackagesMock: vi.fn(),
  setExtensionTrustedMock: vi.fn(),
  setExtensionEnabledMock: vi.fn(),
  projectPathMock: { current: '/tmp/project' },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listExtensionPackages: listExtensionPackagesMock,
    setExtensionTrusted: setExtensionTrustedMock,
    setExtensionEnabled: setExtensionEnabledMock,
  },
}))

vi.mock('@/features/settings/hooks/useSettings', () => ({
  usePreferences: () => ({
    settings: {
      projectPath: projectPathMock.current,
    },
  }),
}))

import { ExtensionsSection } from '../sections/ExtensionsSection'

const EMPTY_VIEW: ExtensionManagerView = {
  projectPath: '/tmp/project',
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
  diagnostics: [],
}

const TRUSTED_LIFECYCLE: NonNullable<ExtensionManagerView['packages'][number]['lifecycle']> = {
  enabled: false,
  trusted: true,
  grantedCapabilities: ['sample.invoke'],
  contentHash: '1234567890abcdef',
  sdkRange: '>=0.1.0 <0.2.0',
  sdkCompatible: true,
  diagnostics: [],
  installedAt: 1000,
  updatedAt: 2000,
}

const PACKAGE_VIEW: ExtensionManagerView = {
  projectPath: '/tmp/project',
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

describe('ExtensionsSection', () => {
  beforeEach(() => {
    listExtensionPackagesMock.mockReset()
    setExtensionTrustedMock.mockReset()
    setExtensionEnabledMock.mockReset()
    projectPathMock.current = '/tmp/project'
  })

  it('loads and renders discovered extension packages for the selected project', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(PACKAGE_VIEW)

    renderWithQueryClient(<ExtensionsSection />)

    expect(screen.getByText(/loading extensions/i)).toBeInTheDocument()
    expect(await screen.findByText('Sample Extension')).toBeInTheDocument()
    expect(screen.getByText('Untrusted')).toBeInTheDocument()
    expect(screen.getByText('SDK compatible')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trust Sample Extension' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable Sample Extension' })).toBeDisabled()
    expect(listExtensionPackagesMock).toHaveBeenCalledWith('/tmp/project')
  })

  it('renders an empty state when no extension packages are found', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(EMPTY_VIEW)

    renderWithQueryClient(<ExtensionsSection />)

    expect(await screen.findByText(/no extension packages discovered/i)).toBeInTheDocument()
  })

  it('refreshes the extension inventory on demand', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(EMPTY_VIEW).mockResolvedValueOnce(PACKAGE_VIEW)

    renderWithQueryClient(<ExtensionsSection />)
    await screen.findByText(/no extension packages discovered/i)
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
        viewProjectPath: '/tmp/project',
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
        viewProjectPath: '/tmp/project',
        enabled: true,
      })
    })
    expect(await screen.findByText('Enabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disable Sample Extension' })).toBeInTheDocument()
  })
})
