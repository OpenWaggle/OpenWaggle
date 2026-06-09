import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { ExtensionInvokeInput, ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { api } from '@/shared/lib/ipc'
import { refreshPreferencesAfterExtensionInvoke } from './extension-broker-preferences'
import {
  type ExtensionFrameInvokeMessage,
  extensionInvokeInputFromFrame,
  postFrameMessage,
} from './extension-frame-host'

function invocationProjectPath(input: ExtensionInvokeInput) {
  return input.scope.kind === 'app' ? null : input.scope.projectPath
}

function outOfScopeInvokeFailure(projectPath: string): ExtensionInvokeResult {
  return {
    ok: false,
    error: {
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
      message: `Project "${projectPath}" is outside this extension contribution scope.`,
    },
  }
}

function describeInvokeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function transportInvokeFailure(error: unknown): ExtensionInvokeResult {
  return {
    ok: false,
    error: {
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.TRANSPORT_FAILED,
      message: 'Extension broker transport failed.',
      issues: [describeInvokeError(error)],
    },
  }
}

function invokeBoundExtension(
  entry: ExtensionContributionRegistryEntry,
  input: ExtensionInvokeInput,
) {
  const projectPath = invocationProjectPath(input)
  if (projectPath !== null && !entry.projectPaths.includes(projectPath)) {
    return Promise.resolve(outOfScopeInvokeFailure(projectPath))
  }

  return api.invokeExtension(input).then(async (result) => {
    await refreshPreferencesAfterExtensionInvoke(result)
    return result
  })
}

export async function handleFrameInvoke(input: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly frameId: string
  readonly frameWindow: Window
  readonly message: ExtensionFrameInvokeMessage
  readonly shouldPostResult: () => boolean
}) {
  const decodedInput = extensionInvokeInputFromFrame(input.entry, input.message.input)
  const result = await (async () => {
    if ('ok' in decodedInput) {
      return decodedInput
    }

    try {
      return await invokeBoundExtension(input.entry, decodedInput)
    } catch (error) {
      return transportInvokeFailure(error)
    }
  })()

  if (!input.shouldPostResult()) {
    return
  }

  postFrameMessage(input.frameWindow, input.frameId, {
    type: 'invoke-result',
    requestId: input.message.requestId,
    result,
  })
}
