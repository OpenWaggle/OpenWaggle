import { describe, expect, it } from 'vitest'
import { installTrustedMainRuntimeGlobalsGuard } from '../trusted-main-network-runtime-globals-guard'

class FakeRedisClient {
  static readonly kind = 'redis'
  readonly #connected = true

  get(key: string) {
    return this.#connected ? `value of ${key}` : null
  }
}

class FakeWebSocket {
  static readonly OPEN = 1
}

function fakeRuntime() {
  const redis = new FakeRedisClient()
  const bun = {
    connect: (port: number) => `connected ${port}`,
    RedisClient: FakeRedisClient,
    redis,
    file: (path: string) => `file ${path}`,
    dns: {
      lookup: (hostname: string) => `looked up ${hostname}`,
      resolve: (hostname: string) => `resolved ${hostname}`,
    },
  }
  const globals = { WebSocket: FakeWebSocket }
  let policyActive = false
  installTrustedMainRuntimeGlobalsGuard(
    {
      enforceBlockedApi: (api) => {
        if (policyActive) throw new Error(`denied ${api}`)
      },
      isAuthorizedHostname: (hostname) => hostname === 'allowed.example',
    },
    { globals, bun },
  )
  return {
    bun,
    globals,
    redis,
    withPolicy: <T>(operation: () => T) => {
      policyActive = true
      try {
        return operation()
      } finally {
        policyActive = false
      }
    },
  }
}

describe('trusted main runtime globals guard', () => {
  it('passes host use through with its receivers, statics and instanceof', () => {
    const { bun, globals, redis } = fakeRuntime()

    expect(bun.connect(443)).toBe('connected 443')
    expect(bun.redis.get('key')).toBe('value of key')
    expect(bun.RedisClient.kind).toBe('redis')
    expect(new bun.RedisClient()).toBeInstanceOf(FakeRedisClient)
    expect(redis).toBeInstanceOf(bun.RedisClient)
    expect(globals.WebSocket.OPEN).toBe(1)
    expect(bun.dns.resolve('example.com')).toBe('resolved example.com')
  })

  it('denies calls, construction and member reads while a policy is active', () => {
    const { bun, globals, withPolicy } = fakeRuntime()

    expect(() => withPolicy(() => bun.connect(443))).toThrow('denied Bun.connect')
    expect(() => withPolicy(() => new bun.RedisClient())).toThrow('denied Bun.RedisClient')
    expect(() => withPolicy(() => bun.redis.get('key'))).toThrow('denied Bun.redis')
    expect(() => withPolicy(() => new globals.WebSocket())).toThrow('denied WebSocket')
    expect(() => withPolicy(() => bun.dns.resolve('example.com'))).toThrow('denied Bun.dns.resolve')
  })

  it('lets a policy read local files and look up the host an allowed request connects to', () => {
    const { bun, globals, withPolicy } = fakeRuntime()

    expect(withPolicy(() => bun.file('/tmp/local'))).toBe('file /tmp/local')
    expect(() => withPolicy(() => bun.file('s3://bucket/key'))).toThrow('denied Bun.file')
    expect(withPolicy(() => bun.dns.lookup('allowed.example'))).toBe('looked up allowed.example')
    expect(() => withPolicy(() => bun.dns.lookup('other.example'))).toThrow('denied Bun.dns.lookup')
    expect(withPolicy(() => globals.WebSocket.OPEN)).toBe(1)
  })
})
