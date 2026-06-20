import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionContributionRuntimeHost } from '../ExtensionContributionRuntimeHost'

const apiMock = vi.hoisted(() => ({
  invokeExtension: vi.fn(),
  openExternal: vi.fn(),
  registerExtensionFrame: vi.fn(),
  unregisterExtensionFrame: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

const INVOKE_FAILURE = {
  ok: false,
  error: {
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_CAPABILITY,
    message: 'No grant.',
  },
} satisfies ExtensionInvokeResult

const TRUSTED_ENTRY: ExtensionContributionRegistryEntry = {
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
  runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.TRUSTED_RENDERER,
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

function extensionFrameId(frame: HTMLIFrameElement) {
  const frameId = frame.dataset.extensionFrameId
  if (!frameId) {
    throw new Error('Expected extension module iframe id.')
  }
  return frameId
}

function dispatchInvoke(frame: HTMLIFrameElement) {
  const frameWindow = stableExtensionFrameWindow(frame)
  window.dispatchEvent(
    new MessageEvent('message', {
      source: frameWindow,
      data: {
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: extensionFrameId(frame),
        type: 'invoke',
        requestId: 'trusted-renderer-request',
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

describe('ExtensionContributionRuntimeHost trusted renderer path', () => {
  beforeEach(() => {
    apiMock.invokeExtension.mockReset()
    apiMock.openExternal.mockReset()
    apiMock.registerExtensionFrame.mockReset()
    apiMock.unregisterExtensionFrame.mockReset()
    apiMock.invokeExtension.mockResolvedValue(INVOKE_FAILURE)
    apiMock.openExternal.mockResolvedValue(undefined)
    apiMock.registerExtensionFrame.mockImplementation((input: { readonly frameId: string }) =>
      Promise.resolve({
        frameUrl: frameUrl(input.frameId),
        registrationId: `registration-${input.frameId}`,
      }),
    )
  })

  it('mounts trusted renderer contributions through an isolated extension frame', async () => {
    render(
      <ExtensionContributionRuntimeHost
        entry={TRUSTED_ENTRY}
        surfacePayload={{ section: 'settings' }}
      />,
    )

    const frame = extensionFrame()
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')

    await waitFor(() => {
      expect(apiMock.registerExtensionFrame).toHaveBeenCalledWith({
        bootstrapUrl: expect.any(String),
        frameId: extensionFrameId(frame),
        networkOrigins: TRUSTED_ENTRY.networkOrigins,
      })
    })
  })

  it('routes trusted renderer capability calls through the frame broker bridge', async () => {
    render(<ExtensionContributionRuntimeHost entry={TRUSTED_ENTRY} />)

    const frame = extensionFrame()
    dispatchInvoke(frame)

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
  })
})
