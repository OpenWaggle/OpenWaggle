import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { listenOnLoopback } from '../website-screenshot-loopback'

const servers: http.Server[] = []

function server() {
  const created = http.createServer((_request, response) => response.end())
  servers.push(created)
  return created
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (created) =>
          new Promise<void>((resolve) =>
            created.listening ? created.close(() => resolve()) : resolve(),
          ),
      ),
  )
})

describe('listenOnLoopback', () => {
  it('resolves with the bound loopback port', async () => {
    const created = server()
    const port = await listenOnLoopback(created, 0)
    expect(port).toBeGreaterThan(0)
    expect(created.address()).toMatchObject({ address: '127.0.0.1', port })
  })

  it('rejects a bind failure instead of emitting an unhandled error', async () => {
    const first = server()
    const port = await listenOnLoopback(first, 0)
    await expect(listenOnLoopback(server(), port)).rejects.toMatchObject({ code: 'EADDRINUSE' })
  })
})
