import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { EXTENSION_FRAME_SURFACE_ACTION } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionSdkInvokeRequest } from '@shared/extension-sdk-core'
import type { ExtensionInvokeResult, ExtensionInvokeScope } from '@shared/types/extension-broker'
import { describe, expect, it, vi } from 'vitest'
import { createFrameExtensionSdk } from '../extension-frame-bootstrap-sdk'

const PROJECT_SCOPE = {
  kind: 'project',
  projectPath: '/tmp/project',
} satisfies ExtensionInvokeScope

const INVOKE_FAILURE = {
  ok: false,
  error: {
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_CAPABILITY,
    message: 'No grant.',
  },
} satisfies ExtensionInvokeResult

describe('createFrameExtensionSdk', () => {
  it('creates the shared broker SDK shape plus frame surface affordances', async () => {
    const invokeBroker = vi.fn<
      (input: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>
    >(async () => INVOKE_FAILURE)
    const post = vi.fn()
    const sdk = createFrameExtensionSdk({ invokeBroker, post })

    expect(sdk).toMatchObject({
      invoke: expect.any(Function),
      hostContext: { getScope: expect.any(Function) },
      storage: {
        packageState: {
          global: expect.objectContaining({ get: expect.any(Function) }),
          project: expect.objectContaining({ list: expect.any(Function) }),
        },
        packageConfig: {
          global: expect.objectContaining({ set: expect.any(Function) }),
          project: expect.objectContaining({ delete: expect.any(Function) }),
        },
      },
      openWaggle: {
        state: {
          get: expect.any(Function),
          readCurrentProject: expect.any(Function),
          readCurrentSession: expect.any(Function),
          readCurrentBranch: expect.any(Function),
          readRecentProjects: expect.any(Function),
          readModelPreferences: expect.any(Function),
        },
        actions: {
          openExternal: expect.any(Function),
          selectProject: expect.any(Function),
        },
        settings: {
          get: expect.any(Function),
          getModelPreferences: expect.any(Function),
          updateModelPreferences: expect.any(Function),
          getProjectDisplayName: expect.any(Function),
          setProjectDisplayName: expect.any(Function),
          update: expect.any(Function),
        },
        docs: {
          discover: expect.any(Function),
          resolveTopic: expect.any(Function),
        },
      },
      surface: {
        sendAction: expect.any(Function),
        respondInteraction: expect.any(Function),
      },
    })

    await sdk.hostContext.getScope(PROJECT_SCOPE)
    await sdk.storage.packageState.project.list(PROJECT_SCOPE)
    await sdk.openWaggle.docs.discover(PROJECT_SCOPE, { includeExtensions: false })
    await sdk.openWaggle.actions.openExternal('https://example.com/issues/113')
    await sdk.surface.respondInteraction({ accepted: true })

    expect(invokeBroker).toHaveBeenNthCalledWith(1, {
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
      scope: PROJECT_SCOPE,
      payload: {},
    })
    expect(invokeBroker).toHaveBeenNthCalledWith(2, {
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
      scope: PROJECT_SCOPE,
      payload: {
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
      },
    })
    expect(invokeBroker).toHaveBeenNthCalledWith(3, {
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
      scope: PROJECT_SCOPE,
      payload: { includeExtensions: false },
    })
    expect(post).toHaveBeenCalledWith({
      type: 'open-external',
      url: 'https://example.com/issues/113',
    })
    expect(post).toHaveBeenCalledWith({
      type: 'surface-action',
      actionId: EXTENSION_FRAME_SURFACE_ACTION.CUSTOM_INTERACTION_RESPONSE,
      payload: { accepted: true },
    })
  })
})
