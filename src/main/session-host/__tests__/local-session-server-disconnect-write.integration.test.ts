import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import type { LocalSessionSocketFrameWriter } from '../local-session-outbound-writer'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { writeLocalSessionSocketFrame } from '../local-session-server-frame'
import { connectLocalSessionTestClient } from './local-session-server-test-client'

const SETTLE_MS = 150
const HANDSHAKE_TIMEOUT_MS = 60

/** The frame kind and code a writer was handed, without asserting the frame's shape. */
function frameKindAndCode(value: unknown) {
  if (typeof value !== 'object' || value === null) return undefined
  const kind = Reflect.get(value, 'kind')
  const code = Reflect.get(value, 'code')
  return {
    kind: typeof kind === 'string' ? kind : undefined,
    code: typeof code === 'string' ? code : undefined,
  }
}

/**
 * A frame writer that reports the kernel's verdict for a write to a peer that went away: the
 * pending write's callback receives EPIPE, exactly as Sentry OPENWAGGLE-8 recorded for the
 * Session Host. Error frames named by `errorCode` fail this way; everything else is written.
 */
function epipeWriter(errorCode: string): LocalSessionSocketFrameWriter {
  return async (input) => {
    const frame = frameKindAndCode(input.value)
    if (frame?.kind === 'error' && frame.code === errorCode) {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    }
    return writeLocalSessionSocketFrame(input)
  }
}

/** Fails a test the way production fails: an escaping unhandled rejection. */
function collectUnhandledRejections() {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  return {
    unhandled,
    stop: () => process.off('unhandledRejection', onUnhandled),
  }
}

describe('Local Session server writes to a client that went away', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  let client: Socket | null = null
  let unhandled: ReturnType<typeof collectUnhandledRejections> | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-disconnect-'))
    unhandled = collectUnhandledRejections()
  })

  afterEach(async () => {
    client?.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
    unhandled?.stop()
    unhandled = null
  })

  async function listen(options: {
    readonly errorCode: string
    readonly handshakeTimeoutMs?: number
  }) {
    const endpoint = path.join(temporaryRoot, 'host.sock')
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub: new SessionHostEventHub({ hostInstanceId: 'host-current' }),
      liveness: new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown: vi.fn() }),
      authenticate: async () => ({ callerId: 'gui:local-user' }),
      dispatch: async () => ({ accepted: true }),
      writeFrame: epipeWriter(options.errorCode),
      ...(options.handshakeTimeoutMs === undefined
        ? {}
        : { handshakeTimeoutMs: options.handshakeTimeoutMs }),
    })
    return endpoint
  }

  it('does not let the protocol-error path raise an unhandled rejection', async () => {
    const endpoint = await listen({ errorCode: 'protocol_error' })
    client = await connectLocalSessionTestClient(endpoint)

    // A well-framed but invalid hello: handling it fails, the connection reports the failure,
    // and reporting it must survive a peer that is already gone.
    client.write(encodeLocalSessionFrame({ notAHello: true }))
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))

    expect(unhandled?.unhandled).toEqual([])
    await handle?.close()
    handle = null
  })

  it('does not let the handshake deadline raise an unhandled rejection', async () => {
    const endpoint = await listen({
      errorCode: 'handshake_timeout',
      handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS,
    })
    client = await connectLocalSessionTestClient(endpoint)
    // The client stalls its handshake and the peer dies while the deadline's error frame is in
    // flight; the injected writer delivers that verdict to the deadline's own send.

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS + HANDSHAKE_TIMEOUT_MS))

    expect(unhandled?.unhandled).toEqual([])
    await handle?.close()
    handle = null
  })
})
