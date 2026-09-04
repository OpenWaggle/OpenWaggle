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

  it('reuses prepared hook headers when the next prompt first compacts', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-deferred-hook-auth-')
    const events: SessionCompactEvent[] = []
    const providerLifecycleCounter = { headerCalls: 0, payloadCalls: 0, responseCalls: 0 }
    const thresholdResponse = fauxAssistantMessage('Reached threshold')
    thresholdResponse.usage.totalTokens = 80
    thresholdResponse.usage.input = 80
    thresholdResponse.timestamp = Date.now() + 60_000
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      providerLifecycleCounter,
      responses: [thresholdResponse, fauxAssistantMessage('Second turn complete')],
    })

    await session.prompt('first turn')
    providerLifecycleCounter.headerCalls = 0
    providerLifecycleCounter.payloadCalls = 0
    providerLifecycleCounter.responseCalls = 0

    await session.prompt('second turn')

    expect(providerLifecycleCounter).toEqual({
      headerCalls: 2,
      payloadCalls: 1,
      responseCalls: 2,
    })
  })
})
