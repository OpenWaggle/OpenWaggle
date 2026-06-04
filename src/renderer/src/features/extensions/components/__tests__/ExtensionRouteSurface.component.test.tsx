import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExtensionRouteSurfaceContent } from '../ExtensionRouteSurface'
import { EXTENSION_ROUTE_IFRAME_SANDBOX } from '../ExtensionSandboxFrame'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

const PROJECT_PATH = '/tmp/project'

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
  projectPaths: [PROJECT_PATH],
  appliesToAllRequestedProjects: true,
  family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.ROUTES,
  contributionId: 'sample.route',
  title: 'Sample route',
  label: 'Sample route',
  lane: 'webview',
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
  render(
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
  it('renders registered extension routes inside a sandboxed iframe foundation', () => {
    renderRouteSurface({ registry: REGISTRY })

    expect(screen.getByText('Extension route')).toBeInTheDocument()
    expect(screen.getByText('Sample route')).toBeInTheDocument()

    const iframe = screen.getByTitle('Extension route: Sample route')
    expect(iframe).toHaveAttribute('sandbox', EXTENSION_ROUTE_IFRAME_SANDBOX)
    expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')

    const srcDoc = iframe.getAttribute('srcdoc') ?? ''
    expect(srcDoc).toContain('Sandboxed iframe host')
    expect(srcDoc).toContain('sample.route')
    expect(srcDoc).not.toContain('window.api')
  })

  it('renders a contained not-found state for unknown route ids', () => {
    renderRouteSurface({ registry: REGISTRY, routeId: 'missing.route' })

    expect(screen.getByRole('alert')).toHaveTextContent('Route contribution not available')
    expect(screen.queryByTitle('Extension route: Sample route')).not.toBeInTheDocument()
  })

  it('renders a contained loading state while registry data is unavailable', () => {
    renderRouteSurface({ registry: null, loading: true })

    expect(screen.getByRole('status')).toHaveTextContent('Loading extension route registry')
  })
})
