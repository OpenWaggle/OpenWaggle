import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { ExtensionInvokeResult } from '@shared/types/extension-broker'
import { usePreferencesStore } from '@/features/settings/state'

function extensionInvokeResultMutatesPreferences(result: ExtensionInvokeResult) {
  if (!result.ok) {
    return false
  }

  if (result.value.capability === OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS) {
    return result.value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT
  }

  if (result.value.capability === OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS) {
    return (
      result.value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS ||
      result.value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING
    )
  }

  return false
}

export async function refreshPreferencesAfterExtensionInvoke(result: ExtensionInvokeResult) {
  if (!extensionInvokeResultMutatesPreferences(result)) {
    return
  }

  await usePreferencesStore.getState().loadSettings()
}
