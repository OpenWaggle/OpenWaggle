import { fauxAssistantMessage } from '@earendil-works/pi-ai'
import type { SessionCompactEvent } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderAttributionExtension } from '../provider-attribution-extension'
import {
  checkpointIds,
  cleanupNativeSessions,
  createNativeSession,
  createNativeTempDirectory,
  nativeCompactionFetch,
} from './pi-native-compaction-integration.test-utils'

const THRESHOLD_TOKENS = 80
const LATER_MS = 60_000

function thresholdResponse(timestamp: number) {
  const response = fauxAssistantMessage('Reached threshold')
  response.usage.totalTokens = THRESHOLD_TOKENS
  response.usage.input = THRESHOLD_TOKENS
  response.timestamp = timestamp
  return response
}

/*
 * The attribution extension registers a `before_provider_headers` handler in every runtime, and
 * Pi treats Native compaction differently while such a handler exists: it keeps the prepared
 * compaction auth instead of refreshing it (agent-session.js, `preserveCompactionAuth`).
 */
describe('OpenWaggle provider attribution with Native compaction', () => {
  afterEach(cleanupNativeSessions)

  it.each([
    ['on', true],
    ['off', false],
  ])(
    'keeps repeated automatic Native compactions working while statistics are %s',
    async (_label, statisticsEnabled) => {
      const directory = createNativeTempDirectory('openwaggle-attribution-native-')
      const events: SessionCompactEvent[] = []
      const requestBodies: string[] = []
      const isUsageStatisticsEnabled = vi.fn(() => statisticsEnabled)
      vi.stubGlobal('fetch', nativeCompactionFetch(requestBodies))
      const later = Date.now() + LATER_MS
      const { session } = await createNativeSession({
        directory,
        compactionEvents: events,
        responses: [
          thresholdResponse(later),
          thresholdResponse(later + 1),
          fauxAssistantMessage('Complete'),
        ],
        extensionFactories: [createProviderAttributionExtension(isUsageStatisticsEnabled)],
      })

      await session.prompt('first turn')
      await session.prompt('second turn')
      await session.prompt('third turn')

      expect(isUsageStatisticsEnabled).toHaveBeenCalled()
      expect(checkpointIds(events)).toEqual(['cmp_1', 'cmp_2'])
      expect(requestBodies[1]).toContain('cmp_1')
      expect(JSON.stringify(session.messages)).toContain('Complete')
    },
  )
})
