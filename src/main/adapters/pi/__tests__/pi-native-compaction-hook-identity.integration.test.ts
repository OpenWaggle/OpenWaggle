import { fauxAssistantMessage } from '@earendil-works/pi-ai'
import type { SessionCompactEvent } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupNativeSessions,
  createNativeSession,
  createNativeTempDirectory,
  nativeCompactionFetch,
} from './pi-native-compaction-integration.test-utils'

describe('Pi native compaction provider-hook identity', () => {
  afterEach(cleanupNativeSessions)

  it('projects a stable identity before repeated manual compaction', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-manual-hook-auth-')
    const events: SessionCompactEvent[] = []
    const requestBodies: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch(requestBodies))
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      providerAuthHeaderState: { authorization: 'Bearer stable-hook-token' },
      responses: [fauxAssistantMessage('More context')],
    })

    await session.compact()
    await session.prompt('Add context after the hook-bound checkpoint')
    await session.compact()

    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[1]).toContain('cmp_1')
  })

  it('projects a stable identity before repeated automatic compaction', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-auto-hook-auth-')
    const events: SessionCompactEvent[] = []
    const requestBodies: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch(requestBodies))
    const thresholdResponse = (timestamp: number) => {
      const response = fauxAssistantMessage('Reached threshold')
      response.usage.totalTokens = 80
      response.usage.input = 80
      response.timestamp = timestamp
      return response
    }
    const future = Date.now() + 60_000
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      providerAuthHeaderState: { authorization: 'Bearer stable-hook-token' },
      responses: [
        thresholdResponse(future),
        thresholdResponse(future + 1),
        fauxAssistantMessage('Complete'),
      ],
    })

    await session.prompt('first turn')
    await session.prompt('second turn')
    await session.prompt('third turn')

    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[1]).toContain('cmp_1')
  })
})
