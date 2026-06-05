import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import {
  EXTENSION_FRAME_BOOTSTRAP_SCRIPT_HASH,
  EXTENSION_FRAME_MESSAGE_CHANNEL,
} from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { describe, expect, it } from 'vitest'
import {
  createExtensionFrameDocument,
  decodeExtensionFrameMessage,
  extensionInvokeInputFromFrame,
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
  it('creates frame document with frame execution mount context and no preload API reference', () => {
    const frameDocument = createExtensionFrameDocument({
      entry: ENTRY,
      frameId: 'frame-1',
      moduleUrl:
        'openwaggle-extension://runtime/module/%2Ftmp%2Fproject%2F.openwaggle%2Fextensions%2Fsample-extension/abcdef/%5B%22%2Ftmp%2Fproject%22%5D/dist/settings.js',
    })

    expect(frameDocument).toContain('data-openwaggle-config=')
    expect(frameDocument).toContain('openwaggle-extension://runtime/module/')
    expect(frameDocument).toContain('&quot;execution&quot;:&quot;frame&quot;')
    expect(frameDocument).toContain('&quot;projectPaths&quot;:[&quot;/tmp/project&quot;]')
    expect(frameDocument).toContain('packageConfig')
    expect(frameDocument).toContain('packageState')
    expect(frameDocument).toContain('http-equiv="Content-Security-Policy"')
    expect(frameDocument).toContain(EXTENSION_FRAME_BOOTSTRAP_SCRIPT_HASH)
    expect(frameDocument).toContain('script-src-elem')
    expect(frameDocument).not.toContain('connect-src')
    expect(frameDocument).not.toContain('window.api')
  })

  it('adds declared network origins to the frame CSP connect-src directive', () => {
    const frameDocument = createExtensionFrameDocument({
      entry: { ...ENTRY, networkOrigins: ['https://api.github.com'] },
      frameId: 'frame-1',
      moduleUrl:
        'openwaggle-extension://runtime/module/%2Ftmp%2Fproject%2F.openwaggle%2Fextensions%2Fsample-extension/abcdef/%5B%22%2Ftmp%2Fproject%22%5D/dist/settings.js',
    })

    expect(frameDocument).toContain('connect-src https://api.github.com')
  })

  it('decodes only extension frame messages for the mounted frame id', () => {
    const message = {
      channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
      frameId: 'frame-1',
      type: 'mounted',
    }

    expect(decodeExtensionFrameMessage(message, 'frame-1')).toEqual(message)
    expect(decodeExtensionFrameMessage(message, 'frame-2')).toBeNull()
    expect(
      decodeExtensionFrameMessage({ ...message, channel: 'other-channel' }, 'frame-1'),
    ).toBeNull()
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
