import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountExtensionFrame } from '../../lib/extension-federated-frame-mount'
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

function extensionFrameId(frame: HTMLIFrameElement) {
  const frameId = frame.dataset.extensionFrameId
  if (!frameId) {
    throw new Error('Expected extension module iframe id.')
  }
  return frameId
}

function equivalentEntry(): ExtensionContributionRegistryEntry {
  return {
    ...ENTRY,
    diagnostics: [...ENTRY.diagnostics],
    eligibility: { ...ENTRY.eligibility },
    projectPaths: [...ENTRY.projectPaths],
  }
}

function dispatchResizeFromWindow(frameId: string, height: number) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      data: {
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId,
        type: 'resize',
        height,
      },
    }),
  )
}

describe('ExtensionFederatedModuleHost lifecycle performance', () => {
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

  it('does not remount when an equivalent registry entry object is recreated', async () => {
    const { rerender } = render(<ExtensionFederatedModuleHost entry={equivalentEntry()} />)
    const frame = extensionFrame()
    await waitFor(() => {
      expect(frame).toHaveAttribute('src', frameUrl(extensionFrameId(frame)))
    })
    const mountedFrameUrl = frame.getAttribute('src')

    rerender(<ExtensionFederatedModuleHost entry={equivalentEntry()} />)

    expect(frame.getAttribute('src')).toBe(mountedFrameUrl)
    expect(apiMock.registerExtensionFrame).toHaveBeenCalledTimes(1)
  })

  it('deduplicates repeated sandbox resize messages before notifying the host', async () => {
    const frame = document.createElement('iframe')
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: window,
    })
    const reportHeight = vi.fn()
    const cleanup = mountExtensionFrame({
      entry: ENTRY,
      frame,
      frameId: 'frame-dedupe',
      frameRuntimeSupported: true,
      getCurrentFrameWindow: () => window,
      moduleUrl: 'openwaggle-extension://runtime/module/sample/dist/settings.js',
      mountKey: 'mount-key',
      reportHeight,
      reportStatus: vi.fn(),
    })

    dispatchResizeFromWindow('frame-dedupe', 120.1)
    dispatchResizeFromWindow('frame-dedupe', 120.1)
    dispatchResizeFromWindow('frame-dedupe', 121)
    dispatchResizeFromWindow('frame-dedupe', 121.2)

    expect(reportHeight).toHaveBeenCalledTimes(2)
    expect(reportHeight).toHaveBeenNthCalledWith(1, 121)
    expect(reportHeight).toHaveBeenNthCalledWith(2, 122)

    cleanup?.()
    await Promise.resolve()
  })
})
