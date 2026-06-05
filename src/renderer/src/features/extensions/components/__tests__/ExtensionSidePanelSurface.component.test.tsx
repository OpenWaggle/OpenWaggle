import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExtensionSidePanelSurfaceContent } from '../ExtensionSidePanelSurface'

const PROJECT_PATH = '/tmp/project'

const SIDE_PANEL_ENTRY: ExtensionContributionRegistryEntry = {
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
  family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
  contributionId: 'sample.side-panel',
  title: 'Sample side panel',
  label: 'Sample side panel',
  runtime: 'federated-module',
  execution: 'host-renderer',
  entryPath: 'dist/side-panel.html',
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

const COMMAND_ENTRY: ExtensionContributionRegistryEntry = {
  ...SIDE_PANEL_ENTRY,
  family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS,
  contributionId: 'sample.run',
  title: 'Run sample',
  label: 'Run sample',
}

const REGISTRY: ExtensionContributionRegistryView = {
  projectPaths: [PROJECT_PATH],
  entries: [COMMAND_ENTRY, SIDE_PANEL_ENTRY],
}

function renderSidePanelSurface(input: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly sidePanelId?: string
  readonly loading?: boolean
  readonly error?: string | null
  readonly onClose?: () => void
}) {
  return render(
    <ExtensionSidePanelSurfaceContent
      error={input.error ?? null}
      loading={input.loading ?? false}
      onClose={input.onClose ?? vi.fn()}
      onRefresh={vi.fn()}
      projectPaths={[PROJECT_PATH]}
      registry={input.registry}
      target={{
        extensionId: 'sample-extension',
        sidePanelId: input.sidePanelId ?? 'sample.side-panel',
      }}
    />,
  )
}

describe('ExtensionSidePanelSurfaceContent', () => {
  it('mounts registered side panel contributions through the federated module host', async () => {
    renderSidePanelSurface({ registry: REGISTRY })

    expect(screen.getByLabelText('Extension side panel')).toBeInTheDocument()
    expect(screen.getAllByText('Sample side panel')).toHaveLength(2)
    expect(screen.queryByText('Run sample')).not.toBeInTheDocument()
    const frame = screen.getByTitle('Extension module: Sample side panel')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', expect.stringContaining('blob:'))
    })
    expect(frame).not.toHaveAttribute('srcdoc')
  })

  it('routes the OpenWaggle-owned close button to the caller', () => {
    const onClose = vi.fn()
    renderSidePanelSurface({ registry: REGISTRY, onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Close extension side panel' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders a contained not-found state for unknown side panel ids', () => {
    renderSidePanelSurface({ registry: REGISTRY, sidePanelId: 'missing.side-panel' })

    expect(screen.getByRole('alert')).toHaveTextContent('Side panel contribution not available')
    expect(screen.queryByTitle('Extension module: Sample side panel')).not.toBeInTheDocument()
  })

  it('renders a contained loading state while registry data is unavailable', () => {
    renderSidePanelSurface({ registry: null, loading: true })

    expect(screen.getByRole('status')).toHaveTextContent('Loading extension side panel registry…')
  })
})
