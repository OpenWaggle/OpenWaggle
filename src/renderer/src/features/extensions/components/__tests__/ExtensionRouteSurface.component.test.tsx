import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionRouteSurfaceContent } from '../ExtensionRouteSurface'

const apiMock = vi.hoisted(() => ({
  onFullscreenChanged: vi.fn(),
  registerExtensionFrame: vi.fn(),
  unregisterExtensionFrame: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

const PROJECT_PATH = '/tmp/project'
const EXTENSION_FRAME_URL_PREFIX = 'openwaggle-extension-frame://frame/frames/'

const ROUTE_ENTRY: ExtensionContributionRegistryEntry = {
  extensionId: 'sample-extension',
  extensionName: 'Sample Extension',
  extensionVersion: '1.0.0',
  scope: {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    label: 'Project',
    projectPath: PROJECT_PATH,
  },
  packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
  manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
  contentHash: 'abcdef',
  projectPaths: [PROJECT_PATH],
  appliesToAllRequestedProjects: true,
  family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.ROUTES,
  contributionId: 'sample.route',
  title: 'Sample route',
  label: 'Sample route',
  runtime: 'federated-module',
  execution: 'host-renderer',
  entryPath: 'dist/route.html',
  eligibility: {
    runtimeEnabled: true,
    enabled: true,
    trusted: true,
    sdkCompatible: true,
    updateAvailable: false,
    disabledProjectPaths: [],
  },
  diagnostics: [],
}

const REGISTRY: ExtensionContributionRegistryView = {
  projectPaths: [PROJECT_PATH],
  entries: [ROUTE_ENTRY],
}

function renderRouteSurface(input: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly routeId?: string
  readonly loading?: boolean
  readonly error?: string | null
}) {
  return render(
    <ExtensionRouteSurfaceContent
      error={input.error ?? null}
      extensionId="sample-extension"
      loading={input.loading ?? false}
      onRefresh={vi.fn()}
      projectPaths={[PROJECT_PATH]}
      registry={input.registry}
      routeId={input.routeId ?? 'sample.route'}
    />,
  )
}

describe('ExtensionRouteSurfaceContent', () => {
  beforeEach(() => {
    apiMock.onFullscreenChanged.mockReset()
    apiMock.registerExtensionFrame.mockReset()
    apiMock.unregisterExtensionFrame.mockReset()
    apiMock.onFullscreenChanged.mockReturnValue(() => undefined)
    apiMock.registerExtensionFrame.mockImplementation((input: { readonly frameId: string }) =>
      Promise.resolve({
        frameUrl: `${EXTENSION_FRAME_URL_PREFIX}${encodeURIComponent(input.frameId)}/index.html`,
        registrationId: `registration-${input.frameId}`,
      }),
    )
    apiMock.unregisterExtensionFrame.mockResolvedValue(undefined)
  })

  it('renders registered extension routes through the federated module mount contract', async () => {
    const { container } = renderRouteSurface({ registry: REGISTRY })

    expect(screen.getByText('Extension route')).toBeInTheDocument()
    expect(screen.getByText('Sample route')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('min-h-0', 'flex-1', 'overflow-hidden')
    expect(screen.getByRole('button', { name: 'Extensions' })).toHaveClass('inline-flex')
    expect(screen.getByLabelText('Extension route breadcrumbs')).toHaveClass('min-w-0', 'flex-1')
    const frame = screen.getByTitle('Extension module: Sample route')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', expect.stringContaining(EXTENSION_FRAME_URL_PREFIX))
    })
    expect(frame).not.toHaveAttribute('srcdoc')
  })

  it('renders a contained not-found state for unknown route ids', () => {
    renderRouteSurface({ registry: REGISTRY, routeId: 'missing.route' })

    expect(screen.getByRole('alert')).toHaveTextContent('Route contribution not available')
    expect(screen.queryByText('Mounted sample-extension/sample.route')).not.toBeInTheDocument()
  })

  it('renders a contained loading state while registry data is unavailable', () => {
    renderRouteSurface({ registry: null, loading: true })

    expect(screen.getByRole('status')).toHaveTextContent('Loading extension route registry…')
  })
})
