import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import { extensionInvokeInputSchema } from '@shared/schemas/extension-broker'
import type { ExtensionInvokeFailure } from '@shared/types/extension-broker'
import * as Effect from 'effect/Effect'
import { invokeExtensionCapability } from '../application/extension-capability-broker-service'
import { typedHandle } from './typed-ipc'

function makeInvalidInputFailure(issues: readonly string[]): ExtensionInvokeFailure {
  return {
    ok: false,
    error: {
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_INPUT,
      message: 'Invalid extension capability invocation.',
      issues,
    },
  }
}

export function registerExtensionBrokerHandlers(): void {
  typedHandle('extensions:invoke', (_event, input: unknown) => {
    const decoded = safeDecodeUnknown(extensionInvokeInputSchema, input)
    if (!decoded.success) {
      return Effect.succeed(makeInvalidInputFailure(decoded.issues))
    }

    return invokeExtensionCapability(decoded.data)
  })
}
