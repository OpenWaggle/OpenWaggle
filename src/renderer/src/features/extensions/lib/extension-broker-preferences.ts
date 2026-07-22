import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { ExtensionInvokeResult } from '@shared/types/extension-broker'
import { usePreferencesStore } from '@/features/settings/state'
import { invalidateExtensionContributionsQueries } from '@/queries/extensions'

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

function extensionInvokeResultMutatesRuntimeContributions(result: ExtensionInvokeResult) {
  if (!result.ok) {
    return false
  }

  if (result.value.capability !== OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME) {
    return false
  }

  return (
    result.value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION ||
    result.value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION
  )
}

export async function refreshPreferencesAfterExtensionInvoke(result: ExtensionInvokeResult) {
  const refreshes: Promise<unknown>[] = []

  if (extensionInvokeResultMutatesPreferences(result)) {
    refreshes.push(usePreferencesStore.getState().loadSettings())
  }

  if (extensionInvokeResultMutatesRuntimeContributions(result)) {
    refreshes.push(invalidateExtensionContributionsQueries())
  }

  await Promise.all(refreshes)
}
