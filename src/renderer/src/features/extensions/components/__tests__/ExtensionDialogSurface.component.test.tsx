import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionDialogSurfaceContent } from '../ExtensionDialogSurface'

const apiMock = vi.hoisted(() => ({
  registerExtensionFrame: vi.fn(),
  unregisterExtensionFrame: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

const PROJECT_PATH = '/tmp/project'
const EXTENSION_FRAME_URL_PREFIX = 'openwaggle-extension-frame://frame/frames/'

const DIALOG_ENTRY: ExtensionContributionRegistryEntry = {
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
  family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
  contributionId: 'sample.dialog',
  title: 'Sample dialog',
  label: 'Sample dialog',
  runtime: 'federated-module',
  execution: 'host-renderer',
  entryPath: 'dist/dialog.js',
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
  ...DIALOG_ENTRY,
  family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS,
  contributionId: 'sample.run',
  title: 'Run sample',
  label: 'Run sample',
}

const REGISTRY: ExtensionContributionRegistryView = {
  projectPaths: [PROJECT_PATH],
  entries: [COMMAND_ENTRY, DIALOG_ENTRY],
}

function renderDialogSurface(input: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly dialogId?: string
  readonly loading?: boolean
  readonly error?: string | null
  readonly onClose?: () => void
}) {
  return render(
    <ExtensionDialogSurfaceContent
      actions={{
        onClose: input.onClose ?? vi.fn(),
        onRefresh: vi.fn(),
      }}
      error={input.error ?? null}
      loading={input.loading ?? false}
      projectPaths={[PROJECT_PATH]}
      registry={input.registry}
      surfacePayload={{ surface: 'dialog-test' }}
      target={{
        extensionId: DIALOG_ENTRY.extensionId,
        dialogId: input.dialogId ?? 'sample.dialog',
        packagePath: DIALOG_ENTRY.packagePath,
        contentHash: DIALOG_ENTRY.contentHash,
      }}
    />,
  )
}

describe('ExtensionDialogSurfaceContent', () => {
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

  it('mounts registered dialog contributions through the federated module host', async () => {
    renderDialogSurface({ registry: REGISTRY })

    expect(screen.getByRole('dialog', { name: 'Sample dialog' }).tagName).toBe('DIALOG')
    expect(screen.getAllByText('Sample dialog')).toHaveLength(1)
    expect(screen.queryByText('Run sample')).not.toBeInTheDocument()
    const frame = screen.getByTitle('Extension module: Sample dialog')
    expect(frame.parentElement).toHaveClass('size-full', 'bg-transparent')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', expect.stringContaining(EXTENSION_FRAME_URL_PREFIX))
    })
    expect(frame).not.toHaveAttribute('srcdoc')
  })

  it('routes the OpenWaggle-owned close button to the caller', () => {
    const onClose = vi.fn()
    renderDialogSurface({ registry: REGISTRY, onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Close extension dialog' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('routes native dialog cancel events to the caller', () => {
    const onClose = vi.fn()
    renderDialogSurface({ registry: REGISTRY, onClose })

    fireEvent(screen.getByRole('dialog', { name: 'Sample dialog' }), new Event('cancel'))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders a contained not-found state for unknown dialog ids', () => {
    renderDialogSurface({ registry: REGISTRY, dialogId: 'missing.dialog' })

    expect(screen.getByRole('alert')).toHaveTextContent('Dialog contribution not available')
    expect(screen.queryByTitle('Extension module: Sample dialog')).not.toBeInTheDocument()
  })

  it('renders a contained loading state while registry data is unavailable', () => {
    renderDialogSurface({ registry: null, loading: true })

    expect(screen.getByRole('status')).toHaveTextContent('Loading extension dialog registry...')
  })
})
