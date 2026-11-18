import { once } from 'node:events'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalSessionFrameReader } from '../local-session-client-connection'
import { encodeLocalSessionFrame } from '../local-session-framing'

const FRAME_COUNT = 200
const FRAME_PAYLOAD_BYTES = 32 * 1024

describe('Local Session frame reader', () => {
  const sockets: net.Socket[] = []
  const servers: net.Server[] = []

  afterEach(async () => {
    for (const socket of sockets) socket.destroy()
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve())
          }),
      ),
    )
  })

  it('pauses transport reads while its consumer handles the current frame', async () => {
    const server = net.createServer()
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server address.')
    const accepted = once(server, 'connection')
    const client = net.createConnection(address.port, '127.0.0.1')
    sockets.push(client)
    await once(client, 'connect')
    const [peer] = await accepted
    if (!(peer instanceof net.Socket)) throw new Error('Expected a Local Session server socket.')
    sockets.push(peer)
    const reader = new LocalSessionFrameReader(client)
    const first = reader.next()
    const frames = Array.from({ length: FRAME_COUNT }, (_, index) =>
      encodeLocalSessionFrame({ index, payload: 'x'.repeat(FRAME_PAYLOAD_BYTES) }),
    )

    expect(peer.write(Buffer.concat(frames))).toBe(false)
    await expect(first).resolves.toMatchObject({ index: 0 })

    expect(client.isPaused()).toBe(true)
    expect(reader.bufferedFrameCount()).toBeLessThan(FRAME_COUNT)
  })
})
