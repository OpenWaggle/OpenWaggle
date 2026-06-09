import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionFrameRegisterInputSchema,
  extensionFrameUnregisterInputSchema,
} from '@shared/schemas/extension-frame'
import * as Effect from 'effect/Effect'
import { registerExtensionFrame, unregisterExtensionFrame } from '../extension-frame-protocol'
import { typedHandle } from './typed-ipc'

function decodeRegisterInput(input: unknown) {
  const decoded = safeDecodeUnknown(extensionFrameRegisterInputSchema, input)
  if (!decoded.success) {
    return Effect.fail(new Error(decoded.issues.join('; ')))
  }

  return Effect.succeed(decoded.data)
}

function decodeUnregisterInput(input: unknown) {
  const decoded = safeDecodeUnknown(extensionFrameUnregisterInputSchema, input)
  if (!decoded.success) {
    return Effect.fail(new Error(decoded.issues.join('; ')))
  }

  return Effect.succeed(decoded.data)
}

export function registerExtensionFrameHandlers(): void {
  typedHandle('extensions:register-frame', (_event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeRegisterInput(input)
      return registerExtensionFrame(decoded)
    }),
  )

  typedHandle('extensions:unregister-frame', (_event, input: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeUnregisterInput(input)
      unregisterExtensionFrame(decoded)
    }),
  )
}
