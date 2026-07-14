import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { ExtensionInvokeInput, ExtensionInvokeResult } from '@shared/types/extension-broker'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { typedHandleMock, invokeExtensionCapabilityMock } = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  invokeExtensionCapabilityMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../application/extension-capability-broker-service', () => ({
  invokeExtensionCapability: invokeExtensionCapabilityMock,
}))

import { registerExtensionBrokerHandlers } from '../extension-broker-handler'

const validInvocation: ExtensionInvokeInput = {
  extensionId: 'sample-extension',
  contributionId: 'sample.run',
  capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
  method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
  scope: { kind: 'project', projectPath: '/tmp/project' },
  payload: {},
}

const successResult: ExtensionInvokeResult = {
  ok: true,
  value: {
    extensionId: 'sample-extension',
    contributionId: 'sample.run',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
    scope: { kind: 'project', projectPath: '/tmp/project' },
    declaredScopes: ['project'],
  },
  audit: {
    extensionId: 'sample-extension',
    contributionId: 'sample.run',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
    scope: { kind: 'project', projectPath: '/tmp/project' },
    outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
    timestamp: 1,
  },
}

function getRegisteredHandler() {
  registerExtensionBrokerHandlers()
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) =>
      candidate[0] === 'extensions:invoke' && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

describe('registerExtensionBrokerHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    invokeExtensionCapabilityMock.mockReset()
    invokeExtensionCapabilityMock.mockImplementation((input: ExtensionInvokeInput) =>
      Effect.succeed({ ...successResult, value: { ...successResult.value, scope: input.scope } }),
    )
  })

  it('registers extensions:invoke and routes valid invocations to the broker service', async () => {
    const handler = getRegisteredHandler()

    const result = await handler?.({}, validInvocation)

    expect(invokeExtensionCapabilityMock).toHaveBeenCalledWith(validInvocation)
    expect(result).toMatchObject({ ok: true, value: { scope: validInvocation.scope } })
  })

  it('returns structured failure DTOs for malformed invocation input', async () => {
    const handler = getRegisteredHandler()

    const result = await handler?.({}, { extensionId: 'Sample Extension' })

    expect(invokeExtensionCapabilityMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: false,
      error: { code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_INPUT },
    })
  })
})
