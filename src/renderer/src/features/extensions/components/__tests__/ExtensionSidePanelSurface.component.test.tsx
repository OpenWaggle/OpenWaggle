import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionSidePanelSurfaceContent } from '../ExtensionSidePanelSurface'

const apiMock = vi.hoisted(() => ({
  registerExtensionFrame: vi.fn(),
  unregisterExtensionFrame: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

const PROJECT_PATH = '/tmp/project'
const EXTENSION_FRAME_URL_PREFIX = 'openwaggle-extension-frame://frame/frames/'

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

const EMPTY_REGISTRY: ExtensionContributionRegistryView = {
  projectPaths: [PROJECT_PATH],
  entries: [],
}

function stableExtensionFrameWindow(frame: HTMLIFrameElement) {
  const frameWindow = frame.contentWindow
  if (!frameWindow) {
    throw new Error('Expected extension module iframe window.')
  }
  Object.defineProperty(frame, 'contentWindow', {
    configurable: true,
    value: frameWindow,
  })
  return frameWindow
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
  beforeEach(() => {
    apiMock.registerExtensionFrame.mockReset()
    apiMock.unregisterExtensionFrame.mockReset()
    apiMock.registerExtensionFrame.mockImplementation((input: { readonly frameId: string }) =>
      Promise.resolve({
        frameUrl: `${EXTENSION_FRAME_URL_PREFIX}${encodeURIComponent(input.frameId)}/index.html`,
        registrationId: `registration-${input.frameId}`,
      }),
    )
    apiMock.unregisterExtensionFrame.mockResolvedValue(undefined)
  })

  it('mounts registered side panel contributions through the federated module host', async () => {
    renderSidePanelSurface({ registry: REGISTRY })

    expect(screen.getByLabelText('Extension side panel')).toBeInTheDocument()
    expect(screen.getAllByText('Sample side panel')).toHaveLength(1)
    expect(screen.queryByText('Run sample')).not.toBeInTheDocument()
    expect(screen.queryByText('federated-module')).not.toBeInTheDocument()
    expect(screen.queryByText('Contribution ID')).not.toBeInTheDocument()
    expect(screen.queryByText('Entry')).not.toBeInTheDocument()
    expect(screen.queryByText('Family')).not.toBeInTheDocument()
    expect(screen.queryByText('sample.side-panel')).not.toBeInTheDocument()
    const frame = screen.getByTitle('Extension module: Sample side panel')
    expect(frame.parentElement).toHaveClass('size-full', 'bg-transparent')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', expect.stringContaining(EXTENSION_FRAME_URL_PREFIX))
    })
    expect(frame).not.toHaveAttribute('srcdoc')
  })

  it('disposes and removes the mounted frame when the registry entry disappears', async () => {
    const { rerender } = renderSidePanelSurface({ registry: REGISTRY })
    const frame = screen.getByTitle('Extension module: Sample side panel')
    if (!(frame instanceof HTMLIFrameElement)) {
      throw new Error('Expected extension module iframe.')
    }
    const frameId = frame.dataset.extensionFrameId
    if (!frameId) {
      throw new Error('Expected extension module iframe id.')
    }
    const postMessage = vi.spyOn(stableExtensionFrameWindow(frame), 'postMessage')

    await waitFor(() => {
      expect(frame).toHaveAttribute('src', expect.stringContaining(EXTENSION_FRAME_URL_PREFIX))
    })

    rerender(
      <ExtensionSidePanelSurfaceContent
        error={null}
        loading={false}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        projectPaths={[PROJECT_PATH]}
        registry={EMPTY_REGISTRY}
        target={{
          extensionId: 'sample-extension',
          sidePanelId: 'sample.side-panel',
        }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Extension side panel not available')
    expect(screen.queryByTitle('Extension module: Sample side panel')).not.toBeInTheDocument()
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId,
        type: 'dispose',
      }),
      '*',
    )
    expect(apiMock.unregisterExtensionFrame).toHaveBeenCalledWith({
      frameId,
      registrationId: `registration-${frameId}`,
    })
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
