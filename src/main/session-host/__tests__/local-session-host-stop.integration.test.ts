import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { type LocalSessionHostRuntime, startLocalSessionHost } from '../local-session-host-runtime'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

const STOP_TIMEOUT_MS = 2_000

async function negotiatedClient(endpoint: string) {
  const socket = await connectLocalSessionTestClient(endpoint)
  const reader = new TestFrameReader(socket)
  socket.write(
    encodeLocalSessionFrame({
      protocol: 'openwaggle-local-session',
      supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
      clientKind: 'cli',
      clientVersion: 'test',
    }),
  )
  await expect(reader.next()).resolves.toMatchObject({ accepted: true })
  let requests = 0
  const send = async (payload: unknown) => {
    requests += 1
    socket.write(encodeLocalSessionFrame({ kind: 'command', requestId: `r-${requests}`, payload }))
    return reader.next()
  }
  return { socket, send }
}

function stopped(runtime: LocalSessionHostRuntime) {
  return Promise.race([
    runtime.waitUntilStopped().then(() => 'stopped'),
    new Promise((resolve) => setTimeout(() => resolve('still running'), STOP_TIMEOUT_MS)),
  ])
}

describe('stopping a live Session Host', () => {
  let temporaryRoot = ''
  let runtime: LocalSessionHostRuntime | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-host-stop-'))
  })

  afterEach(async () => {
    if (runtime) await runtime.stop()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('answers the stop, keeps answering work-ending commands, and exits when work ends', async () => {
    const endpoint = path.join(temporaryRoot, 'host.sock')
    runtime = await startLocalSessionHost({
      endpoint,
      databasePath: path.join(temporaryRoot, 'session-host.sqlite'),
      idleGracePeriodMs: 60_000,
      authenticate: async () => ({ callerId: 'local-user:test' }),
      dispatch: async (input) =>
        Reflect.get(Object(input.payload), 'contract') === 'local-host-v1'
          ? { stopping: input.requestHostStop() }
          : { accepted: true },
    })
    const releaseRun = runtime.liveness.acquire('run')
    const client = await negotiatedClient(endpoint)

    await expect(client.send({ contract: 'local-host-v1' })).resolves.toMatchObject({
      kind: 'response',
      payload: { stopping: { runningActions: 0 } },
    })
    await expect(
      client.send({
        contract: 'session-control-v2',
        request: { command: { operation: 'interrupt' } },
      }),
    ).resolves.toMatchObject({ kind: 'response', payload: { accepted: true } })
    await expect(client.send({ contract: 'session-lifecycle-v2' })).resolves.toMatchObject({
      kind: 'error',
      message: expect.stringContaining('The Session Host is stopping'),
    })

    releaseRun()
    await expect(stopped(runtime)).resolves.toBe('stopped')
    client.socket.destroy()
  })
})
