import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type {
  ExtensionCapabilityAuditEntry,
  ExtensionInvokeInput,
} from '@shared/types/extension-broker'
import { describe, expect, it, vi } from 'vitest'
import { createExtensionBrokerSdk, type ExtensionBrokerTransport } from '../extension-sdk'

const PROJECT_SCOPE = { kind: 'project', projectPath: '/tmp/project' } as const
const APP_SCOPE = { kind: 'app' } as const
const TIMESTAMP = 1234

function auditFor(input: ExtensionInvokeInput): ExtensionCapabilityAuditEntry {
  return {
    extensionId: input.extensionId,
    contributionId: input.contributionId,
    capability: input.capability,
    method: input.method,
    scope: input.scope,
    outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
    timestamp: TIMESTAMP,
  }
}

describe('createExtensionBrokerSdk OpenWaggle helpers', () => {
  it('builds typed OpenWaggle state reads through the generic broker', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => {
      if (input.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE) {
        return {
          ok: true,
          value: {
            extensionId: input.extensionId,
            contributionId: input.contributionId,
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
            scope: input.scope,
            selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.MODEL_PREFERENCES,
            value: {
              selectedModel: '',
              favoriteModels: [],
              enabledModels: [],
              thinkingLevel: 'medium',
            },
          },
          audit: auditFor(input),
        }
      }

      return {
        ok: true,
        value: {
          extensionId: input.extensionId,
          contributionId: input.contributionId,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
          scope: input.scope,
          activeProjectPath: PROJECT_SCOPE.projectPath,
          currentProject: {
            projectPath: PROJECT_SCOPE.projectPath,
            displayName: null,
            active: true,
          },
          currentSession: null,
          currentBranch: null,
          recentProjects: [PROJECT_SCOPE.projectPath],
          modelPreferences: {
            selectedModel: '',
            favoriteModels: [],
            enabledModels: [],
            thinkingLevel: 'medium',
          },
        },
        audit: auditFor(input),
      }
    })
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.state',
    })

    const result = await sdk.openWaggle.state.get(PROJECT_SCOPE)
    const modelPrefsResult = await sdk.openWaggle.state.readModelPreferences(PROJECT_SCOPE)

    expect(result).toMatchObject({
      ok: true,
      value: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
      },
    })
    expect(modelPrefsResult).toMatchObject({
      ok: true,
      value: {
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
        selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.MODEL_PREFERENCES,
        value: {
          thinkingLevel: 'medium',
        },
      },
    })
    expect(transport).toHaveBeenNthCalledWith(1, {
      extensionId: 'sample-extension',
      contributionId: 'sample.state',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
      scope: PROJECT_SCOPE,
      payload: {},
    })
    expect(transport).toHaveBeenNthCalledWith(2, {
      extensionId: 'sample-extension',
      contributionId: 'sample.state',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
      scope: PROJECT_SCOPE,
      payload: {
        selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.MODEL_PREFERENCES,
      },
    })
  })

  it('builds typed OpenWaggle action and settings calls', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => ({
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNKNOWN_EXTENSION,
        message: 'Unknown extension.',
      },
      audit: auditFor(input),
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
    })

    await sdk.openWaggle.actions.selectProject(APP_SCOPE, PROJECT_SCOPE.projectPath)
    await sdk.openWaggle.settings.update(APP_SCOPE, {
      thinkingLevel: 'high',
      projectDisplayNames: { [PROJECT_SCOPE.projectPath]: 'OpenWaggle' },
    })
    await sdk.openWaggle.settings.setProjectDisplayName(
      APP_SCOPE,
      PROJECT_SCOPE.projectPath,
      'OpenWaggle',
    )
    await sdk.openWaggle.settings.updateModelPreferences(APP_SCOPE, {
      thinkingLevel: 'minimal',
    })

    expect(transport).toHaveBeenNthCalledWith(1, {
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
      scope: APP_SCOPE,
      payload: { projectPath: PROJECT_SCOPE.projectPath },
    })
    expect(transport).toHaveBeenNthCalledWith(2, {
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
      scope: APP_SCOPE,
      payload: {
        thinkingLevel: 'high',
        projectDisplayNames: { [PROJECT_SCOPE.projectPath]: 'OpenWaggle' },
      },
    })
    expect(transport).toHaveBeenNthCalledWith(3, {
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
      scope: APP_SCOPE,
      payload: {
        key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME,
        projectPath: PROJECT_SCOPE.projectPath,
        value: 'OpenWaggle',
      },
    })
    expect(transport).toHaveBeenNthCalledWith(4, {
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
      scope: APP_SCOPE,
      payload: {
        key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES,
        value: {
          thinkingLevel: 'minimal',
        },
      },
    })
  })
})
