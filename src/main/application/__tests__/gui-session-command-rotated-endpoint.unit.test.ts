import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type LocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from '../../session-host/local-session-paths'
import {
  configureGuiSessionCommandClient,
  dispatchConfiguredGuiSessionCommand,
  GuiSessionHostRetiredForUpgradeError,
  retireGuiSessionCommandClientForUpgrade,
} from '../gui-session-command-router'

const oldEndpoint = '\\\\.\\pipe\\openwaggle-old-session-host'
const newEndpoint = '\\\\.\\pipe\\openwaggle-new-session-host'
const paths = {
  ...resolveLocalSessionHostPaths({ userDataRoot: '/windows-profile', platform: 'win32' }),
  endpoint: oldEndpoint,
}

function statusCommand(requestId: string) {
  return {
    caller: { callerId: 'gui:local-user' as const },
    payload: {
      contract: 'session-query-v2' as const,
      request: {
        contractVersion: 2 as const,
        requestId,
        query: { operation: 'status' as const, sessionId: 'session-1' },
      },
    },
  }
}

describe('GUI command endpoint recovery', () => {
  afterEach(() => configureGuiSessionCommandClient(null))

  it('retries on the rotated endpoint and retains it for later commands', async () => {
    configureGuiSessionCommandClient({ paths, clientVersion: 'test' })
    const unavailable = Object.assign(new Error('retired pipe'), { code: 'ENOENT' })
    const response = { contract: 'session-query-v2' as const, response: { requestId: 'ok' } }
    const execute = vi.fn().mockRejectedValueOnce(unavailable).mockResolvedValue(response)
    const ensure = vi.fn(async () => undefined)
    const refreshPaths = vi.fn(async (candidate: LocalSessionHostPaths) => ({
      ...candidate,
      endpoint: ensure.mock.calls.length > 0 ? newEndpoint : candidate.endpoint,
    }))
    const dependencies = { execute, ensure, refreshPaths }
    const first = dispatchConfiguredGuiSessionCommand(statusCommand('first'), dependencies)
    if (!first) throw new Error('Expected a remote GUI command.')
    await expect(Effect.runPromise(first)).resolves.toBe(response)

    const second = dispatchConfiguredGuiSessionCommand(statusCommand('second'), dependencies)
    if (!second) throw new Error('Expected a remote GUI command.')
    await expect(Effect.runPromise(second)).resolves.toBe(response)

    expect(execute.mock.calls.map(([input]) => input.paths.endpoint)).toEqual([
      oldEndpoint,
      newEndpoint,
      newEndpoint,
    ])
    expect(ensure).toHaveBeenCalledOnce()
    expect(refreshPaths).toHaveBeenCalledTimes(3)
  })

  it('refreshes a rotated endpoint before a non-replayable GUI mutation', async () => {
    configureGuiSessionCommandClient({ paths, clientVersion: 'test' })
    const response = { contract: 'local-ui-v1' as const, response: { requestId: 'pin' } }
    const execute = vi.fn().mockResolvedValue(response)
    const ensure = vi.fn(async () => undefined)
    const refreshPaths = vi.fn(async (candidate: LocalSessionHostPaths) => ({
      ...candidate,
      endpoint: newEndpoint,
    }))
    const command = dispatchConfiguredGuiSessionCommand(
      {
        caller: { callerId: 'gui:local-user' },
        payload: {
          contract: 'local-ui-v1',
          request: {
            requestId: 'pin',
            command: { operation: 'pin', sessionId: 'session-1' },
          },
        },
      },
      { execute, ensure, refreshPaths },
    )
    if (!command) throw new Error('Expected a remote GUI command.')

    await expect(Effect.runPromise(command)).resolves.toBe(response)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]?.[0].paths.endpoint).toBe(newEndpoint)
    expect(ensure).not.toHaveBeenCalled()
  })

  it('can start the Host before a non-replayable mutation when endpoint discovery is missing', async () => {
    configureGuiSessionCommandClient({ paths, clientVersion: 'test' })
    const unavailable = Object.assign(new Error('capability missing'), { code: 'ENOENT' })
    const response = { contract: 'local-ui-v1' as const, response: { requestId: 'pin' } }
    const execute = vi.fn().mockResolvedValue(response)
    const ensure = vi.fn(async () => undefined)
    const refreshPaths = vi
      .fn()
      .mockRejectedValueOnce(unavailable)
      .mockImplementationOnce(async (candidate: LocalSessionHostPaths) => ({
        ...candidate,
        endpoint: newEndpoint,
      }))
    const command = dispatchConfiguredGuiSessionCommand(
      {
        caller: { callerId: 'gui:local-user' },
        payload: {
          contract: 'local-ui-v1',
          request: {
            requestId: 'pin',
            command: { operation: 'pin', sessionId: 'session-1' },
          },
        },
      },
      { execute, ensure, refreshPaths },
    )
    if (!command) throw new Error('Expected a remote GUI command.')

    await expect(Effect.runPromise(command)).resolves.toBe(response)
    expect(ensure).toHaveBeenCalledOnce()
    expect(refreshPaths).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]?.[0].paths.endpoint).toBe(newEndpoint)
  })

  it('does not execute an effect created before its GUI route was retired', async () => {
    configureGuiSessionCommandClient({ paths, clientVersion: 'test' })
    const execute = vi.fn()
    const refreshPaths = vi.fn(async (candidate: LocalSessionHostPaths) => candidate)
    const command = dispatchConfiguredGuiSessionCommand(statusCommand('stale'), {
      execute,
      refreshPaths,
    })
    if (!command) throw new Error('Expected a remote GUI command.')
    retireGuiSessionCommandClientForUpgrade()

    await expect(Effect.runPromise(Effect.flip(command))).resolves.toMatchObject({
      cause: expect.any(GuiSessionHostRetiredForUpgradeError),
    })
    expect(execute).not.toHaveBeenCalled()
    expect(refreshPaths).not.toHaveBeenCalled()
  })

  it('does not resurrect a GUI route retired during Host recovery', async () => {
    configureGuiSessionCommandClient({ paths, clientVersion: 'test' })
    const execute = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('retired pipe'), { code: 'ENOENT' }))
    const ensure = vi.fn(async () => retireGuiSessionCommandClientForUpgrade())
    const refreshPaths = vi.fn(async (candidate: LocalSessionHostPaths) => candidate)
    const command = dispatchConfiguredGuiSessionCommand(statusCommand('retired'), {
      execute,
      ensure,
      refreshPaths,
    })
    if (!command) throw new Error('Expected a remote GUI command.')

    await expect(Effect.runPromise(Effect.flip(command))).resolves.toMatchObject({
      cause: expect.any(GuiSessionHostRetiredForUpgradeError),
    })
    expect(execute).toHaveBeenCalledOnce()
    expect(refreshPaths).toHaveBeenCalledOnce()
  })
})
