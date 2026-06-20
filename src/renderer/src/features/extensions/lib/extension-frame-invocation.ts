import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { invokeBoundExtension, transportInvokeFailure } from './extension-contribution-invocation'
import {
  type ExtensionFrameInvokeMessage,
  extensionInvokeInputFromFrame,
  postFrameMessage,
} from './extension-frame-host'

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
