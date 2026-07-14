import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { createOpenWaggleExtensionTheme } from '@shared/extension-theme'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { describe, expect, it, vi } from 'vitest'
import {
  decodeExtensionFrameMessage,
  extensionFrameConfig,
  extensionInvokeInputFromFrame,
  postFrameMessage,
} from '../extension-frame-host'

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
  execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME,
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
describe('extension frame host helpers', () => {
  it('creates typed frame execution mount configuration without DOM or SDK fields', () => {
    const config = extensionFrameConfig({
      entry: ENTRY,
      moduleUrl:
        'openwaggle-extension://runtime/module/%2Ftmp%2Fproject%2F.openwaggle%2Fextensions%2Fsample-extension/abcdef/%5B%22%2Ftmp%2Fproject%22%5D/dist/settings.js',
    })

    expect(config).toEqual({
      moduleUrl:
        'openwaggle-extension://runtime/module/%2Ftmp%2Fproject%2F.openwaggle%2Fextensions%2Fsample-extension/abcdef/%5B%22%2Ftmp%2Fproject%22%5D/dist/settings.js',
      context: {
        extension: {
          id: 'sample-extension',
          name: 'Sample Extension',
          version: '1.0.0',
        },
        contribution: {
          id: 'sample.settings',
          title: 'Sample settings',
          family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
        },
        surface: {
          family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
          execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME,
        },
        packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
        projectPaths: ['/tmp/project'],
        theme: createOpenWaggleExtensionTheme(),
      },
    })
  })

  it('decodes only extension frame messages for the mounted frame id', () => {
    const message = {
      channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
      frameId: 'frame-1',
      type: 'ready',
    }

    expect(decodeExtensionFrameMessage(message, 'frame-1')).toEqual(message)
    expect(decodeExtensionFrameMessage(message, 'frame-2')).toBeNull()
    expect(
      decodeExtensionFrameMessage({ ...message, channel: 'other-channel' }, 'frame-1'),
    ).toBeNull()
  })

  it('posts typed configure messages to the frame window', () => {
    const frameWindow = {
      postMessage: vi.fn(),
    } satisfies Pick<Window, 'postMessage'>
    const config = extensionFrameConfig({
      entry: ENTRY,
      moduleUrl: 'openwaggle-extension://runtime/module/sample/dist/settings.js',
    })

    postFrameMessage(frameWindow, 'frame-1', {
      type: 'configure',
      config,
    })

    expect(frameWindow.postMessage).toHaveBeenCalledWith(
      {
        channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
        frameId: 'frame-1',
        type: 'configure',
        config,
      },
      '*',
    )
  })

  it('binds frame SDK invocations to the mounted contribution identity', () => {
    const input = extensionInvokeInputFromFrame(ENTRY, {
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
      scope: { kind: 'project', projectPath: '/tmp/project' },
      payload: { includeProjects: true },
    })

    expect(input).toMatchObject({
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
      scope: { kind: 'project', projectPath: '/tmp/project' },
      payload: { includeProjects: true },
    })
  })

  it('rejects malformed frame SDK invocation input without reaching the host API', () => {
    expect(extensionInvokeInputFromFrame(ENTRY, { method: 'missing-capability' })).toMatchObject({
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_INPUT,
      },
    })
  })
})
