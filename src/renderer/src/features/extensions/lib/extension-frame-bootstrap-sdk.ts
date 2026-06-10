import { EXTENSION_FRAME_SURFACE_ACTION } from '@shared/constants/extension-frame'
import { createExtensionBrokerSdkFromInvoke } from '@shared/extension-sdk'
import type { ExtensionSdkInvokeRequest } from '@shared/extension-sdk-core'
import type { ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { JsonValue } from '@shared/types/json'
import type { OpenWaggleExtensionMountContext } from './extension-federated-module'

type ExtensionFrameSdk = OpenWaggleExtensionMountContext['sdk']
type FramePost = (
  message:
    | { readonly type: 'open-external'; readonly url: string }
    | { readonly type: 'surface-action'; readonly actionId: string; readonly payload?: JsonValue },
) => void

function frameOpenExternal(post: FramePost) {
  return (url: string) => {
    post({ type: 'open-external', url })
    return Promise.resolve()
  }
}

function frameSurfaceSdk(post: FramePost): ExtensionFrameSdk['surface'] {
  return {
    sendAction: (actionId, payload) => {
      post(
        payload === undefined
          ? { type: 'surface-action', actionId }
          : { type: 'surface-action', actionId, payload },
      )
      return Promise.resolve()
    },
    respondInteraction: (value) => {
      post({
        type: 'surface-action',
        actionId: EXTENSION_FRAME_SURFACE_ACTION.CUSTOM_INTERACTION_RESPONSE,
        payload: value,
      })
      return Promise.resolve()
    },
  }
}

export function createFrameExtensionSdk(input: {
  readonly invokeBroker: (input: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>
  readonly post: FramePost
}): ExtensionFrameSdk {
  const brokerSdk = createExtensionBrokerSdkFromInvoke(input.invokeBroker, {
    openExternal: frameOpenExternal(input.post),
  })

  return {
    ...brokerSdk,
    surface: frameSurfaceSdk(input.post),
  }
}
