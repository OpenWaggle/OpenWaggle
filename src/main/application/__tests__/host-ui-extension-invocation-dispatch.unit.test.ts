import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import type { HostUiV1Request } from '@shared/types/host-ui-protocol'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeExtensionCapabilityMock } = vi.hoisted(() => ({
  invokeExtensionCapabilityMock: vi.fn(),
}))

vi.mock('../extension-capability-broker-service', () => ({
  invokeExtensionCapability: invokeExtensionCapabilityMock,
}))

import { dispatchHostUiRequest } from '../host-ui-request-dispatcher'

const invocation: ExtensionInvokeInput = {
  extensionId: 'sample-extension',
  contributionId: 'sample.run',
  capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
  method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
  scope: { kind: 'project', projectPath: '/tmp/project' },
  payload: {},
}

function request(args: HostUiV1Request['args']): HostUiV1Request {
  return {
    contractVersion: 1,
    requestId: 'invoke-extension',
    channel: 'extensions:invoke',
    args,
  }
}

function invoke(args: HostUiV1Request['args']) {
  const effect = dispatchHostUiRequest({
    caller: { callerId: 'gui:local-user' },
    request: request(args),
  })
  return Effect.runPromise(
    fromAny<Effect.Effect<Effect.Effect.Success<typeof effect>, unknown, never>, typeof effect>(
      effect,
    ),
  )
}

describe('Host UI extension invocation dispatch', () => {
  beforeEach(() => {
    invokeExtensionCapabilityMock.mockReset()
    invokeExtensionCapabilityMock.mockReturnValue(Effect.succeed({ ok: true, value: 'invoked' }))
  })

  it('forwards the host-issued invocation binding to the extension broker', async () => {
    const result = await invoke([
      { kind: 'value', value: invocation },
      { kind: 'value', value: 'host-issued-binding' },
    ])

    expect(invokeExtensionCapabilityMock).toHaveBeenCalledWith(invocation, {
      invocationBinding: 'host-issued-binding',
    })
    expect(result.response.result).toEqual({ kind: 'value', value: { ok: true, value: 'invoked' } })
  })

  it('keeps legacy one-argument invocations valid', async () => {
    await invoke([{ kind: 'value', value: invocation }])

    expect(invokeExtensionCapabilityMock).toHaveBeenCalledWith(invocation)
  })

  it('rejects malformed bindings before reaching the broker', async () => {
    const result = await invoke([
      { kind: 'value', value: invocation },
      { kind: 'value', value: '' },
    ])

    expect(invokeExtensionCapabilityMock).not.toHaveBeenCalled()
    expect(result.response.result).toMatchObject({
      kind: 'value',
      value: { ok: false, error: { code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_INPUT } },
    })
  })

  it('rejects extra arguments', async () => {
    await expect(
      invoke([
        { kind: 'value', value: invocation },
        { kind: 'value', value: 'host-issued-binding' },
        { kind: 'value', value: 'unexpected' },
      ]),
    ).rejects.toThrow('Expected 1 to 2 Host UI arguments')

    expect(invokeExtensionCapabilityMock).not.toHaveBeenCalled()
  })
})
