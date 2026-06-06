import { createHash } from 'node:crypto'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import {
  EXTENSION_FRAME_BOOTSTRAP_SCRIPT,
  EXTENSION_FRAME_BOOTSTRAP_SCRIPT_HASH,
  EXTENSION_FRAME_MESSAGE_CHANNEL,
} from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createExtensionFrameDocument } from '../../lib/extension-frame-host'
import { ExtensionFederatedModuleHost } from '../ExtensionFederatedModuleHost'

const apiMock = vi.hoisted(() => ({
  invokeExtension: vi.fn(),
  openExternal: vi.fn(),
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

function extensionFrameHost(frame: HTMLIFrameElement) {
  const host = frame.parentElement
  if (host === null) {
    throw new Error('Expected extension module iframe host.')
  }
  return host
}

function dispatchOpenExternal(frame: HTMLIFrameElement, url: string) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: extensionFrameWindow(frame),
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
  window.dispatchEvent(
    new MessageEvent('message', {
      source: extensionFrameWindow(frame),
      data: {
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: extensionFrameId(frame),
        type: 'resize',
        height,
      },
    }),
  )
}

function dispatchInvoke(frame: HTMLIFrameElement, requestId: string) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: extensionFrameWindow(frame),
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
      expect(frame).toHaveAttribute('src', expect.stringContaining('blob:'))
    })
  })

  it('asks the isolated frame to dispose on unmount', async () => {
    const { unmount } = render(<ExtensionFederatedModuleHost entry={ENTRY} />)
    const frame = extensionFrame()
    const postMessage = vi.spyOn(extensionFrameWindow(frame), 'postMessage')
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL')
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', expect.stringContaining('blob:'))
    })
    const frameUrl = frame.getAttribute('src')
    if (frameUrl === null) {
      throw new Error('Expected extension frame document URL.')
    }

    unmount()

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: extensionFrameId(frame),
        type: 'dispose',
      }),
      '*',
    )
    expect(revokeObjectUrl).toHaveBeenCalledWith(frameUrl)
  })

  it('creates frame document with static bootstrap code and data-only mount configuration', () => {
    const frameDocument = createExtensionFrameDocument({
      entry: ENTRY,
      frameId: 'frame-1',
      moduleUrl:
        'openwaggle-extension://runtime/module/%2Ftmp%2Fproject%2F.openwaggle%2Fextensions%2Fsample-extension/abcdef/%5B%22%2Ftmp%2Fproject%22%5D/dist/settings.js',
    })

    expect(frameDocument).toContain('data-openwaggle-config=')
    expect(frameDocument).toContain('openwaggle-extension://runtime/module/')
    expect(frameDocument).toContain('openExternal:')
    expect(frameDocument).toContain('height: 100%; min-height: 0;')
    expect(frameDocument).not.toContain('window.api')
  })

  it('keeps the frame bootstrap CSP hash synchronized with the script content', () => {
    const bootstrapHash = createHash('sha256')
      .update(EXTENSION_FRAME_BOOTSTRAP_SCRIPT)
      .digest('base64')

    expect(`'sha256-${bootstrapHash}'`).toBe(EXTENSION_FRAME_BOOTSTRAP_SCRIPT_HASH)
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
    const postMessage = vi.spyOn(extensionFrameWindow(frame), 'postMessage')

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
