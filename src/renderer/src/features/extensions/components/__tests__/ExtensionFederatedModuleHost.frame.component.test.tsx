import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionFederatedModuleHost } from '../ExtensionFederatedModuleHost'

const apiMock = vi.hoisted(() => ({
  invokeExtension: vi.fn(),
  openExternal: vi.fn(),
  registerExtensionFrame: vi.fn(),
  unregisterExtensionFrame: vi.fn(),
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
function frameUrl(frameId: string) {
  return `openwaggle-extension-frame://frame/frames/${encodeURIComponent(frameId)}/index.html`
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

function stableExtensionFrameWindow(frame: HTMLIFrameElement) {
  const frameWindow = extensionFrameWindow(frame)
  Object.defineProperty(frame, 'contentWindow', {
    configurable: true,
    value: frameWindow,
  })
  return frameWindow
}

function extensionFrameId(frame: HTMLIFrameElement) {
  const frameId = frame.dataset.extensionFrameId
  if (!frameId) {
    throw new Error('Expected extension module iframe id.')
  }
  return frameId
}

function extensionFrameHost(frame: HTMLIFrameElement) {
  const host = frame.parentElement
  if (host === null) {
    throw new Error('Expected extension module iframe host.')
  }
  return host
}

function dispatchOpenExternal(frame: HTMLIFrameElement, url: string) {
  const frameWindow = stableExtensionFrameWindow(frame)
  window.dispatchEvent(
    new MessageEvent('message', {
      source: frameWindow,
      data: {
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: extensionFrameId(frame),
        type: 'open-external',
        url,
      },
    }),
  )
}

function dispatchResize(frame: HTMLIFrameElement, height: number) {
  const frameWindow = stableExtensionFrameWindow(frame)
  window.dispatchEvent(
    new MessageEvent('message', {
      source: frameWindow,
      data: {
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: extensionFrameId(frame),
        type: 'resize',
        height,
      },
    }),
  )
}

function dispatchReady(frame: HTMLIFrameElement) {
  const frameWindow = stableExtensionFrameWindow(frame)
  window.dispatchEvent(
    new MessageEvent('message', {
      source: frameWindow,
      data: {
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: extensionFrameId(frame),
        type: 'ready',
      },
    }),
  )
}

function dispatchInvoke(frame: HTMLIFrameElement, requestId: string) {
  const frameWindow = stableExtensionFrameWindow(frame)
  window.dispatchEvent(
    new MessageEvent('message', {
      source: frameWindow,
      data: {
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: extensionFrameId(frame),
        type: 'invoke',
        requestId,
        input: {
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
          scope: { kind: 'project', projectPath: '/tmp/project' },
          payload: {},
        },
      },
    }),
  )
}

function createDeferredInvokeResult() {
  const result = {
    ok: false,
    error: {
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_CAPABILITY,
      message: 'No grant.',
    },
  }
  let resolveResult: (value: typeof result) => void = () => undefined
  const promise = new Promise<typeof result>((resolve) => {
    resolveResult = resolve
  })
  return { promise, resolve: () => resolveResult(result) }
}

describe('ExtensionFederatedModuleHost frame shell', () => {
  beforeEach(() => {
    apiMock.invokeExtension.mockReset()
    apiMock.openExternal.mockReset()
    apiMock.registerExtensionFrame.mockReset()
    apiMock.unregisterExtensionFrame.mockReset()
    apiMock.registerExtensionFrame.mockImplementation((input: { readonly frameId: string }) =>
      Promise.resolve({
        frameUrl: frameUrl(input.frameId),
        registrationId: `registration-${input.frameId}`,
      }),
    )
    apiMock.unregisterExtensionFrame.mockResolvedValue(undefined)
  })

  it('can mount as a bare full-height surface when the container owns the chrome', async () => {
    render(<ExtensionFederatedModuleHost chrome="bare" entry={ENTRY} fill />)

    const frame = extensionFrame()
    const host = extensionFrameHost(frame)
    expect(host).toHaveClass('flex', 'size-full', 'min-h-0', 'bg-transparent')
    expect(host).not.toHaveClass('rounded-md')
    expect(host).not.toHaveClass('border')
    expect(frame).toHaveClass('min-h-0', 'flex-1')

    await waitFor(() => {
      expect(frame).toHaveAttribute('src', frameUrl(extensionFrameId(frame)))
    })
  })

  it('asks the isolated frame to dispose on unmount', async () => {
    const { unmount } = render(<ExtensionFederatedModuleHost entry={ENTRY} />)
    const frame = extensionFrame()
    const postMessage = vi.spyOn(stableExtensionFrameWindow(frame), 'postMessage')
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', frameUrl(extensionFrameId(frame)))
    })

    unmount()

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: extensionFrameId(frame),
        type: 'dispose',
      }),
      '*',
    )
    expect(apiMock.unregisterExtensionFrame).toHaveBeenCalledWith({
      frameId: extensionFrameId(frame),
      registrationId: `registration-${extensionFrameId(frame)}`,
    })
  })

  it('registers the protocol frame and configures it after the ready handshake', async () => {
    render(<ExtensionFederatedModuleHost entry={ENTRY} />)
    const frame = extensionFrame()
    const postMessage = vi.spyOn(stableExtensionFrameWindow(frame), 'postMessage')

    await waitFor(() => {
      expect(apiMock.registerExtensionFrame).toHaveBeenCalledWith({
        frameId: extensionFrameId(frame),
        bootstrapUrl: expect.stringContaining('extension-frame-bootstrap'),
        networkOrigins: undefined,
      })
    })

    dispatchReady(frame)

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
          frameId: extensionFrameId(frame),
          type: 'configure',
          config: expect.objectContaining({
            moduleUrl: expect.stringContaining('openwaggle-extension://runtime/module/'),
            context: expect.objectContaining({
              extension: {
                id: 'sample-extension',
                name: 'Sample Extension',
                version: '1.0.0',
              },
              packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
            }),
          }),
        }),
        '*',
      )
    })
  })

  it('auto-sizes non-fill frames from sandbox resize messages', async () => {
    render(
      <ExtensionFederatedModuleHost
        autoHeight
        entry={ENTRY}
        maxAutoHeight={300}
        minAutoHeight={100}
      />,
    )
    const frame = extensionFrame()

    expect(frame).toHaveStyle({ height: '100px' })

    dispatchResize(frame, 242)

    await waitFor(() => {
      expect(frame).toHaveStyle({ height: '242px' })
    })

    dispatchResize(frame, 900)

    await waitFor(() => {
      expect(frame).toHaveStyle({ height: '300px' })
    })
  })

  it('opens frame-requested external links through the host IPC bridge', async () => {
    apiMock.openExternal.mockResolvedValue(undefined)
    render(<ExtensionFederatedModuleHost entry={ENTRY} />)
    const frame = extensionFrame()

    dispatchOpenExternal(frame, 'https://github.com/OpenWaggle/OpenWaggle/issues/113')

    await waitFor(() => {
      expect(apiMock.openExternal).toHaveBeenCalledWith(
        'https://github.com/OpenWaggle/OpenWaggle/issues/113',
      )
    })
  })

  it('blocks frame-requested external links with unsupported protocols', async () => {
    render(<ExtensionFederatedModuleHost entry={ENTRY} />)
    const frame = extensionFrame()

    dispatchOpenExternal(frame, 'javascript:alert(1)')
    dispatchOpenExternal(frame, 'not a url')

    await Promise.resolve()

    expect(apiMock.openExternal).not.toHaveBeenCalled()
  })

  it('does not post stale SDK invocation results after the frame is disposed', async () => {
    const deferred = createDeferredInvokeResult()
    apiMock.invokeExtension.mockReturnValue(deferred.promise)
    const { unmount } = render(<ExtensionFederatedModuleHost entry={ENTRY} />)
    const frame = extensionFrame()
    const postMessage = vi.spyOn(stableExtensionFrameWindow(frame), 'postMessage')

    dispatchInvoke(frame, 'invoke-stale')

    await waitFor(() => {
      expect(apiMock.invokeExtension).toHaveBeenCalled()
    })

    unmount()
    postMessage.mockClear()
    deferred.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(postMessage).not.toHaveBeenCalled()
  })
})
