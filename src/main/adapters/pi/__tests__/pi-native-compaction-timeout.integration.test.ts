import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupNativeSessions,
  createNativeSession,
  createNativeTempDirectory,
} from './pi-native-compaction-integration.test-utils'

describe('Pi native compaction timeout', () => {
  afterEach(cleanupNativeSessions)

  it('applies the configured HTTP idle timeout to native compaction', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-timeout-')
    let requestSignal: AbortSignal | null = null
    vi.stubGlobal('fetch', async (_input: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal ?? null
      return await new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener(
          'abort',
          () => reject(requestSignal?.reason ?? new Error('Request aborted')),
          { once: true },
        )
      })
    })
    const { session } = await createNativeSession({
      directory,
      compactionEvents: [],
      contextWindow: 10_000,
      httpIdleTimeoutMs: 25,
    })

    const outcome = await Promise.race([
      session.compact().then(
        () => 'resolved' as const,
        () => 'rejected' as const,
      ),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 250)),
    ])
    if (outcome === 'pending') session.abortCompaction()

    expect(outcome).toBe('rejected')
    expect(requestSignal).toEqual(expect.objectContaining({ aborted: true }))
  })
})
