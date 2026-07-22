import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { ExtensionInvokeResult } from '@shared/types/extension-broker'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshPreferencesAfterExtensionInvoke } from '../extension-broker-preferences'

const { loadSettingsMock } = vi.hoisted(() => ({
  loadSettingsMock: vi.fn<() => Promise<void>>(),
}))
const { invalidateExtensionContributionsQueriesMock } = vi.hoisted(() => ({
  invalidateExtensionContributionsQueriesMock: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/features/settings/state', () => ({
  usePreferencesStore: {
    getState: () => ({ loadSettings: loadSettingsMock }),
  },
}))
vi.mock('@/queries/extensions', () => ({
  invalidateExtensionContributionsQueries: invalidateExtensionContributionsQueriesMock,
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

const REGISTER_CONTRIBUTION_RESULT = {
  ok: true,
  value: {
    extensionId: 'sample-extension',
    contributionId: 'sample.settings',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
    family: 'toolRenderers',
    registeredContributionId: 'sample.tool',
  },
  audit: {
    extensionId: 'sample-extension',
    contributionId: 'sample.settings',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
    scope: { kind: 'project', projectPath: '/tmp/project' },
    outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
    timestamp: 1234,
  },
} satisfies ExtensionInvokeResult

const UNREGISTER_CONTRIBUTION_RESULT = {
  ok: true,
  value: {
    extensionId: 'sample-extension',
    contributionId: 'sample.settings',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
    family: 'toolRenderers',
    unregisteredContributionId: 'sample.tool',
    unregistered: true,
  },
  audit: {
    extensionId: 'sample-extension',
    contributionId: 'sample.settings',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
    scope: { kind: 'project', projectPath: '/tmp/project' },
    outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
    timestamp: 1234,
  },
} satisfies ExtensionInvokeResult

describe('refreshPreferencesAfterExtensionInvoke', () => {
  beforeEach(() => {
    loadSettingsMock.mockReset()
    loadSettingsMock.mockResolvedValue(undefined)
    invalidateExtensionContributionsQueriesMock.mockReset()
    invalidateExtensionContributionsQueriesMock.mockResolvedValue(undefined)
  })

  it('refreshes preferences after typed setting updates', async () => {
    await refreshPreferencesAfterExtensionInvoke(UPDATE_SETTING_RESULT)

    expect(loadSettingsMock).toHaveBeenCalledTimes(1)
  })

  it('does not refresh preferences after typed setting reads', async () => {
    await refreshPreferencesAfterExtensionInvoke(GET_SETTING_RESULT)

    expect(loadSettingsMock).not.toHaveBeenCalled()
    expect(invalidateExtensionContributionsQueriesMock).not.toHaveBeenCalled()
  })

  it('invalidates contribution queries after runtime contribution registration changes', async () => {
    await refreshPreferencesAfterExtensionInvoke(REGISTER_CONTRIBUTION_RESULT)
    await refreshPreferencesAfterExtensionInvoke(UNREGISTER_CONTRIBUTION_RESULT)

    expect(loadSettingsMock).not.toHaveBeenCalled()
    expect(invalidateExtensionContributionsQueriesMock).toHaveBeenCalledTimes(2)
  })
})
