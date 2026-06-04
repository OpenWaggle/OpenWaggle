import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createExtensionFrameSrcDoc,
  EXTENSION_FEDERATED_MODULE_IFRAME_SANDBOX,
} from '../../lib/extension-frame-host'
import { ExtensionFederatedModuleHost } from '../ExtensionFederatedModuleHost'

const apiMock = vi.hoisted(() => ({
  invokeExtension: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

const ENTRY: ExtensionContributionRegistryEntry = {
  extensionId: 'sample-extension',
  extensionName: 'Sample Extension',
  extensionVersion: '1.0.0',
  scope: {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    label: 'Project',
    projectPath: '/tmp/project',
  },
  packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
  manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
  contentHash: 'abcdef',
  projectPaths: ['/tmp/project'],
  appliesToAllRequestedProjects: true,
  family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
  contributionId: 'sample.settings',
  title: 'Sample settings',
  label: 'Sample settings',
  runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
  execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
  entryPath: 'dist/settings.js',
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

function extensionFrame() {
  const frame = screen.getByTitle('Extension module: Sample settings')
  if (!(frame instanceof HTMLIFrameElement)) {
    throw new Error('Expected extension module iframe.')
  }
  return frame
}

function extensionFrameWindow(frame: HTMLIFrameElement) {
  const frameWindow = frame.contentWindow
  if (!frameWindow) {
    throw new Error('Expected extension module iframe window.')
  }
  return frameWindow
}

function extensionFrameId(frame: HTMLIFrameElement) {
  const frameId = frame.dataset.extensionFrameId
  if (!frameId) {
    throw new Error('Expected extension module iframe id.')
  }
  return frameId
}

function dispatchFrameMessage(
  frame: HTMLIFrameElement,
  message:
    | { readonly type: 'mounted' }
    | { readonly type: 'error' | 'cleanup-error'; readonly message: string }
    | { readonly type: 'invoke'; readonly requestId: string; readonly input: unknown },
) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: extensionFrameWindow(frame),
      data: {
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: extensionFrameId(frame),
        ...message,
      },
    }),
  )
}

describe('ExtensionFederatedModuleHost', () => {
  beforeEach(() => {
    apiMock.invokeExtension.mockReset()
  })

  it('mounts federated modules in an isolated iframe without exposing the preload API', async () => {
    render(<ExtensionFederatedModuleHost entry={ENTRY} />)

    const frame = extensionFrame()
    expect(frame).toHaveAttribute('sandbox', EXTENSION_FEDERATED_MODULE_IFRAME_SANDBOX)
    expect(screen.getByText(/Mounting extension module/)).toBeInTheDocument()

    await waitFor(() => {
      expect(frame.srcdoc).toContain('openwaggle-extension://runtime/module/')
    })
    expect(frame.srcdoc).toContain('%5B%22%2Ftmp%2Fproject%22%5D')
    expect(frame.srcdoc).not.toContain('window.api')

    dispatchFrameMessage(frame, { type: 'mounted' })

    await waitFor(() => {
      expect(screen.queryByText(/Mounting extension module/)).not.toBeInTheDocument()
    })
  })

  it('creates frame srcdoc with static bootstrap code and data-only mount configuration', () => {
    const srcDoc = createExtensionFrameSrcDoc({
      entry: ENTRY,
      frameId: 'frame-1',
      moduleUrl:
        'openwaggle-extension://runtime/module/%2Ftmp%2Fproject%2F.openwaggle%2Fextensions%2Fsample-extension/abcdef/%5B%22%2Ftmp%2Fproject%22%5D/dist/settings.js',
    })

    expect(srcDoc).toContain('data-openwaggle-config=')
    expect(srcDoc).toContain('openwaggle-extension://runtime/module/')
    expect(srcDoc).not.toContain('window.api')
  })

  it('proxies valid SDK invocations through the bound contribution identity', async () => {
    const invokeResult = {
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.CAPABILITY_NOT_GRANTED,
        message: 'No grant.',
      },
    }
    apiMock.invokeExtension.mockResolvedValue(invokeResult)
    render(<ExtensionFederatedModuleHost entry={ENTRY} />)
    const frame = extensionFrame()
    const postMessage = vi.spyOn(extensionFrameWindow(frame), 'postMessage')

    dispatchFrameMessage(frame, {
      type: 'invoke',
      requestId: 'invoke-1',
      input: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
        scope: { kind: 'project', projectPath: '/tmp/project' },
        payload: {},
      },
    })

    await waitFor(() => {
      expect(apiMock.invokeExtension).toHaveBeenCalledWith({
        extensionId: 'sample-extension',
        contributionId: 'sample.settings',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
        scope: { kind: 'project', projectPath: '/tmp/project' },
        payload: {},
      })
    })
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        type: 'invoke-result',
        requestId: 'invoke-1',
        result: invokeResult,
      }),
      '*',
    )
  })

  it('rejects SDK invocations outside the mounted contribution project scope', async () => {
    render(<ExtensionFederatedModuleHost entry={ENTRY} />)
    const frame = extensionFrame()
    const postMessage = vi.spyOn(extensionFrameWindow(frame), 'postMessage')

    dispatchFrameMessage(frame, {
      type: 'invoke',
      requestId: 'invoke-2',
      input: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
        scope: { kind: 'project', projectPath: '/tmp/other-project' },
        payload: {},
      },
    })

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'invoke-result',
          requestId: 'invoke-2',
          result: expect.objectContaining({
            ok: false,
            error: expect.objectContaining({
              code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
            }),
          }),
        }),
        '*',
      )
    })
    expect(apiMock.invokeExtension).not.toHaveBeenCalled()
  })

  it('contains frame-reported mount and cleanup errors', async () => {
    render(<ExtensionFederatedModuleHost entry={ENTRY} />)
    const frame = extensionFrame()

    dispatchFrameMessage(frame, { type: 'error', message: 'bad module' })
    expect(await screen.findByRole('alert')).toHaveTextContent('bad module')

    dispatchFrameMessage(frame, { type: 'cleanup-error', message: 'cleanup failed' })
    expect(await screen.findByRole('alert')).toHaveTextContent('cleanup failed')
  })

  it('asks the isolated frame to dispose on unmount', async () => {
    const { unmount } = render(<ExtensionFederatedModuleHost entry={ENTRY} />)
    const frame = extensionFrame()
    const postMessage = vi.spyOn(extensionFrameWindow(frame), 'postMessage')

    unmount()

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: extensionFrameId(frame),
        type: 'dispose',
      }),
      '*',
    )
  })

  it('does not mount frame execution in the host-renderer slice', () => {
    render(
      <ExtensionFederatedModuleHost
        entry={{ ...ENTRY, execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Frame execution uses the federated-module contract',
    )
  })
})
