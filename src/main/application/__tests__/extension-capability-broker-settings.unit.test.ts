import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { describe, expect, it } from 'vitest'
import { BROKER_EXTENSION_ID, makeBrokerHarness } from './extension-capability-broker-test-utils'
import {
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const SETTINGS_CONTRIBUTION_ID = 'openwaggle.settings.manage'

function makeSettingsBrokerPackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'Settings Broker Extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        methods: [
          OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
          OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
        ],
        scopes: ['app', 'project'],
      },
    ],
    contributions: {
      commands: [
        {
          id: SETTINGS_CONTRIBUTION_ID,
          title: 'Manage Settings',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          methods: [
            OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
            OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
          ],
        },
      ],
    },
  })
}

describe('invokeExtensionCapability settings capability', () => {
  it('updates the declared OpenWaggle settings subset through the broker', async () => {
    const extensionPackage = makeSettingsBrokerPackage()
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    const updateResult = await harness.run({
      extensionId: BROKER_EXTENSION_ID,
      contributionId: SETTINGS_CONTRIBUTION_ID,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
      scope: { kind: 'project', projectPath: PROJECT_PATH },
      payload: {
        thinkingLevel: 'high',
        favoriteModels: ['openai/gpt-5.5'],
        projectDisplayNames: { [PROJECT_PATH]: 'OpenWaggle Core' },
      },
    })
    const getResult = await harness.run({
      extensionId: BROKER_EXTENSION_ID,
      contributionId: SETTINGS_CONTRIBUTION_ID,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
      scope: { kind: 'project', projectPath: PROJECT_PATH },
      payload: {},
    })

    expect(updateResult).toMatchObject({
      ok: true,
      value: {
        settings: {
          modelPreferences: {
            thinkingLevel: 'high',
            favoriteModels: ['openai/gpt-5.5'],
          },
          projectDisplayNames: { [PROJECT_PATH]: 'OpenWaggle Core' },
        },
      },
    })
    expect(getResult).toMatchObject({
      ok: true,
      value: {
        settings: {
          modelPreferences: {
            thinkingLevel: 'high',
            favoriteModels: ['openai/gpt-5.5'],
          },
          projectDisplayNames: { [PROJECT_PATH]: 'OpenWaggle Core' },
        },
      },
    })
  })
})
