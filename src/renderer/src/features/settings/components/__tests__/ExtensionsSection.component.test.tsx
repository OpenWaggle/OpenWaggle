import type { ExtensionManagerView } from '@shared/types/extensions'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const { listExtensionPackagesMock, projectPathMock } = vi.hoisted(() => ({
  listExtensionPackagesMock: vi.fn(),
  projectPathMock: { current: '/tmp/project' },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listExtensionPackages: listExtensionPackagesMock,
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

const PACKAGE_VIEW: ExtensionManagerView = {
  projectPath: '/tmp/project',
  packages: [
    {
      id: 'sample-extension',
      scope: {
        kind: 'project',
        label: 'Project',
        projectPath: '/tmp/project',
      },
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
    },
  ],
}

describe('ExtensionsSection', () => {
  beforeEach(() => {
    listExtensionPackagesMock.mockReset()
    projectPathMock.current = '/tmp/project'
  })

  it('loads and renders discovered extension packages for the selected project', async () => {
    listExtensionPackagesMock.mockResolvedValueOnce(PACKAGE_VIEW)

    renderWithQueryClient(<ExtensionsSection />)

    expect(screen.getByText(/loading extensions/i)).toBeInTheDocument()
    expect(await screen.findByText('Sample Extension')).toBeInTheDocument()
    expect(screen.getByText('Untrusted')).toBeInTheDocument()
    expect(screen.getByText('SDK compatible')).toBeInTheDocument()
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
})
