import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalSessionAuthenticator } from '../../session-host/local-session-authenticator'
import {
  type LocalSessionHostRuntime,
  startLocalSessionHost,
} from '../../session-host/local-session-host-runtime'
import {
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from '../../session-host/local-session-paths'
import { ensureLocalUserCredential } from '../../session-host/local-user-credential'
import {
  configureGuiSessionCommandClient,
  dispatchConfiguredGuiSessionCommand,
  GuiSessionHostRetiredForUpgradeError,
  retireGuiSessionCommandClientForUpgrade,
} from '../local-session-command-dispatcher'

function requestIdFromPayload(payload: unknown) {
  if (typeof payload !== 'object' || payload === null || !('request' in payload)) return 'unknown'
  const request = payload.request
  return typeof request === 'object' && request !== null && 'requestId' in request
    ? String(request.requestId)
    : 'unknown'
}

describe('GUI Session Host command client', () => {
  let temporaryRoot = ''
  let runtime: LocalSessionHostRuntime | null = null
  let endpointDirectory: string | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-gui-host-client-'))
  })

  afterEach(async () => {
    configureGuiSessionCommandClient(null)
    await runtime?.stop()
    if (endpointDirectory) await fs.rm(endpointDirectory, { recursive: true, force: true })
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('routes GUI commands through an already-running Session Host', async () => {
    const paths = resolveLocalSessionHostPaths({
      userDataRoot: temporaryRoot,
      temporaryRoot: '/tmp',
      platform: 'darwin',
    })
    endpointDirectory = paths.endpointDirectory === paths.stateRoot ? null : paths.endpointDirectory
    await prepareLocalSessionHostPaths(paths)
    const credential = await ensureLocalUserCredential(paths.credentialPath)
    runtime = await startLocalSessionHost({
      endpoint: paths.endpoint,
      databasePath: paths.databasePath,
      idleGracePeriodMs: 60_000,
      authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
      dispatch: async ({ payload }) => ({
        contract: 'session-query-v2',
        response: {
          contractVersion: 2,
          requestId: requestIdFromPayload(payload),
          outcome: {
            operation: 'status',
            sessionId: 'session-1',
            stateRevision: 4,
            queueState: 'running',
            queueRevision: 0,
            activeRunId: null,
            pendingFollowUpCount: 0,
          },
        },
      }),
    })
    configureGuiSessionCommandClient({ paths, clientVersion: 'test' })

    const remote = dispatchConfiguredGuiSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: '/project' },
      payload: {
        contract: 'session-query-v2',
        request: {
          contractVersion: 2,
          requestId: 'gui-status',
          query: { operation: 'status', sessionId: 'session-1' },
        },
      },
    })
    if (!remote) throw new Error('Expected the configured GUI Session client.')
    const result = await Effect.runPromise(remote)

    expect(result).toMatchObject({
      contract: 'session-query-v2',
      response: { requestId: 'gui-status', outcome: { stateRevision: 4 } },
    })
  })

  it('reacquires a crashed detached Host and safely retries the idempotent command', async () => {
    const paths = resolveLocalSessionHostPaths({ userDataRoot: temporaryRoot })
    configureGuiSessionCommandClient({ paths, clientVersion: 'test' })
    const unavailable = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
    const response = {
      contract: 'session-query-v2' as const,
      response: {
        contractVersion: 2 as const,
        requestId: 'gui-status-retry',
        outcome: {
          operation: 'status' as const,
          sessionId: 'session-1',
          stateRevision: 1,
          queueState: 'running' as const,
          queueRevision: 0,
          activeRunId: null,
          pendingFollowUpCount: 0,
        },
      },
    }
    const execute = vi.fn().mockRejectedValueOnce(unavailable).mockResolvedValueOnce(response)
    const ensure = vi.fn(async () => undefined)
    const remote = dispatchConfiguredGuiSessionCommand(
      {
        caller: { callerId: 'gui:local-user' },
        payload: {
          contract: 'session-query-v2',
          request: {
            contractVersion: 2,
            requestId: 'gui-status-retry',
            query: { operation: 'status', sessionId: 'session-1' },
          },
        },
      },
      { execute, ensure },
    )
    if (!remote) throw new Error('Expected the configured GUI Session client.')

    await expect(Effect.runPromise(remote)).resolves.toEqual(response)
    expect(ensure).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('does not retry explicit Waggle after an ambiguous transport reset', async () => {
    configureGuiSessionCommandClient({
      paths: resolveLocalSessionHostPaths({ userDataRoot: temporaryRoot }),
      clientVersion: 'test',
    })
    const reset = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    const execute = vi.fn().mockRejectedValue(reset)
    const ensure = vi.fn(async () => undefined)
    const remote = dispatchConfiguredGuiSessionCommand(
      {
        caller: { callerId: 'gui:local-user' },
        payload: {
          contract: 'session-waggle-v1',
          request: {
            contractVersion: 1,
            requestId: 'gui-waggle-reset',
            idempotencyKey: 'gui-waggle-once',
            sessionId: 'session-1',
            payload: { text: 'Review.', thinkingLevel: 'medium', attachments: [] },
            model: 'openai/gpt-5.4',
            config: {
              mode: 'sequential',
              agents: [
                { label: 'Architect', model: '$inherit', roleDescription: 'Plan', color: 'blue' },
                { label: 'Reviewer', model: '$inherit', roleDescription: 'Review', color: 'amber' },
              ],
              stop: { primary: 'consensus', maxTurnsSafety: 4 },
            },
          },
        },
      },
      { execute, ensure },
    )
    if (!remote) throw new Error('Expected the configured GUI Session client.')

    await expect(Effect.runPromise(remote)).rejects.toThrow()
    expect(execute).toHaveBeenCalledOnce()
    expect(ensure).not.toHaveBeenCalled()
  })

  it('fails closed instead of dispatching locally after an upgrade handoff', async () => {
    const execute = vi.fn()
    const ensure = vi.fn()
    retireGuiSessionCommandClientForUpgrade()

    const remote = dispatchConfiguredGuiSessionCommand(
      {
        caller: { callerId: 'gui:local-user' },
        payload: {
          contract: 'session-query-v2',
          request: {
            contractVersion: 2,
            requestId: 'retired-gui-status',
            query: { operation: 'status', sessionId: 'session-1' },
          },
        },
      },
      { execute, ensure },
    )

    if (!remote) throw new Error('A retired GUI must not fall through to local dispatch.')
    const retiredError = await Effect.runPromise(Effect.flip(remote))
    expect(retiredError).toBeInstanceOf(GuiSessionHostRetiredForUpgradeError)
    expect(execute).not.toHaveBeenCalled()
    expect(ensure).not.toHaveBeenCalled()
  })
})
