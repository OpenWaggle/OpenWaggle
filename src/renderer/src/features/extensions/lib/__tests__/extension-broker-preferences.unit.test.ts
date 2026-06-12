import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { ExtensionInvokeResult } from '@shared/types/extension-broker'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshPreferencesAfterExtensionInvoke } from '../extension-broker-preferences'

const { loadSettingsMock } = vi.hoisted(() => ({
  loadSettingsMock: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/features/settings/state', () => ({
  usePreferencesStore: {
    getState: () => ({ loadSettings: loadSettingsMock }),
  },
}))

const UPDATE_SETTING_RESULT = {
  ok: true,
  value: {
    extensionId: 'sample-extension',
    contributionId: 'sample.settings',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
    setting: {
      key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES,
      value: {
        selectedModel: '',
        favoriteModels: [],
        enabledModels: [],
        thinkingLevel: 'medium',
      },
    },
  },
  audit: {
    extensionId: 'sample-extension',
    contributionId: 'sample.settings',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
    scope: { kind: 'app' },
    outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
    timestamp: 1234,
  },
} satisfies ExtensionInvokeResult

const GET_SETTING_RESULT = {
  ok: true,
  value: {
    extensionId: 'sample-extension',
    contributionId: 'sample.settings',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
    setting: {
      key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES,
      value: {
        selectedModel: '',
        favoriteModels: [],
        enabledModels: [],
        thinkingLevel: 'medium',
      },
    },
  },
  audit: {
    extensionId: 'sample-extension',
    contributionId: 'sample.settings',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
    scope: { kind: 'app' },
    outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
    timestamp: 1234,
  },
} satisfies ExtensionInvokeResult

describe('refreshPreferencesAfterExtensionInvoke', () => {
  beforeEach(() => {
    loadSettingsMock.mockReset()
    loadSettingsMock.mockResolvedValue(undefined)
  })

  it('refreshes preferences after typed setting updates', async () => {
    await refreshPreferencesAfterExtensionInvoke(UPDATE_SETTING_RESULT)

    expect(loadSettingsMock).toHaveBeenCalledTimes(1)
  })

  it('does not refresh preferences after typed setting reads', async () => {
    await refreshPreferencesAfterExtensionInvoke(GET_SETTING_RESULT)

    expect(loadSettingsMock).not.toHaveBeenCalled()
  })
})
