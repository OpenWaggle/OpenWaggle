import { TERMINAL } from '@shared/constants/resource-limits'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupTerminals,
  fakeEvent,
  getInvokeHandler,
  getSendHandler,
  registerTerminalHandlers,
  resetTerminalHandlerTest,
  serviceMocks,
} from './terminal-handler-test-harness'

describe('terminal input and output handlers', () => {
  beforeEach(resetTerminalHandlerTest)

  it('terminal:write writes valid input through the service', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:write')
    const maxInput = 'x'.repeat(TERMINAL.MAX_INPUT_BYTES)

    await expect(handler?.(fakeEvent, 'session-1', 'main', 'echo hello')).resolves.toEqual({
      status: 'queued',
      acceptedBytes: 10,
    })
    await handler?.(fakeEvent, 'session-1', 'main', maxInput)

    expect(serviceMocks.write).toHaveBeenCalledWith('session-1', 'main', 'echo hello')
    expect(serviceMocks.write).toHaveBeenCalledWith('session-1', 'main', maxInput)
    expect(serviceMocks.write).toHaveBeenCalledTimes(2)
  })

  it('terminal:write validates and acknowledges an idempotent input identity', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:write')
    const identity = { generation: 'renderer-generation-a', sequence: 7 }

    await expect(
      handler?.(fakeEvent, 'session-1', 'main', 'echo hello', identity),
    ).resolves.toEqual({ status: 'queued', acceptedBytes: 10, identity })

    expect(serviceMocks.write).toHaveBeenCalledWith('session-1', 'main', 'echo hello', identity)
  })

  it('terminal:write accepts one larger atomic Project Action with an idempotent intent', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:write')
    const identity = { generation: 'renderer-generation-a', sequence: 8 }
    const intent = { kind: 'project-action', executionId: 'action-1' }
    const command = `${'🙂'.repeat(8_192)}\r`

    await expect(
      handler?.(fakeEvent, 'session-1', 'main', command, identity, intent),
    ).resolves.toEqual({
      status: 'queued',
      acceptedBytes: command.length,
      identity,
    })

    expect(serviceMocks.write).toHaveBeenCalledWith('session-1', 'main', command, identity, intent)
  })

  it('terminal:write requires identity for semantic input and rejects invalid intents', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:write')
    const identity = { generation: 'renderer-generation-a', sequence: 8 }

    await expect(
      handler?.(fakeEvent, 'session-1', 'main', 'pnpm test\r', undefined, {
        kind: 'project-action',
        executionId: 'action-1',
      }),
    ).rejects.toThrow('idempotency identity')
    await expect(
      handler?.(fakeEvent, 'session-1', 'main', 'pnpm test\r', identity, {
        kind: 'project-action',
        executionId: '',
      }),
    ).rejects.toThrow()
    await expect(
      handler?.(fakeEvent, 'session-1', 'main', 'pnpm test\r', identity, {
        kind: 'other',
        executionId: 'action-1',
      }),
    ).rejects.toThrow()

    expect(serviceMocks.write).not.toHaveBeenCalled()
  })

  it('terminal:write ignores oversized and empty input', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:write')
    const oversized = 'x'.repeat(TERMINAL.MAX_INPUT_BYTES + 1)

    await expect(handler?.(fakeEvent, 'session-1', 'main', oversized)).resolves.toEqual({
      status: 'rejected',
      acceptedBytes: 0,
      reason: 'input-too-large',
    })
    await expect(handler?.(fakeEvent, 'session-1', 'main', '')).resolves.toEqual({
      status: 'rejected',
      acceptedBytes: 0,
      reason: 'empty',
    })

    const actionSizedInput = `${'🙂'.repeat(8_192)}\r`
    await expect(handler?.(fakeEvent, 'session-1', 'main', actionSizedInput)).resolves.toEqual({
      status: 'rejected',
      acceptedBytes: 0,
      reason: 'input-too-large',
    })

    expect(serviceMocks.write).not.toHaveBeenCalled()
  })

  it('releases queued input explicitly for an unknown shell', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:send-input-now')

    await expect(handler?.(fakeEvent, 'session-1', 'main')).resolves.toEqual({
      status: 'released',
      releasedBytes: 12,
    })
    expect(serviceMocks.sendInputNow).toHaveBeenCalledWith('session-1', 'main')
  })

  it('acknowledges an exact output generation and offset', async () => {
    registerTerminalHandlers()
    const handler = getSendHandler('terminal:ack-output')

    await handler?.(fakeEvent, 'session-1', 'main', 3, 42)

    expect(serviceMocks.acknowledgeOutput).toHaveBeenCalledWith('session-1', 'main', 3, 42)
  })

  it('migrates a draft terminal owner through the service', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:migrate-owner')

    await expect(handler?.(fakeEvent, 'draft:/repo', 'session-1')).resolves.toEqual({
      terminalIds: ['main'],
    })
    expect(serviceMocks.migrateOwner).toHaveBeenCalledWith('draft:/repo', 'session-1')
  })

  it('cleanupTerminals closes every terminal on shutdown', async () => {
    registerTerminalHandlers()

    await cleanupTerminals()

    expect(serviceMocks.closeAll).toHaveBeenCalledOnce()
  })

  it('propagates an unconfirmed terminal cleanup so app quit can stay fail-closed', async () => {
    const failure = new Error('terminal tree still alive')
    serviceMocks.closeAll.mockImplementationOnce(() => {
      throw failure
    })

    await expect(cleanupTerminals()).rejects.toThrow(failure.message)
  })
})
