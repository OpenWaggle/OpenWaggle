import { type FauxResponseStep, fauxAssistantMessage } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAtomicVisualizationPrompt } from '../pi-runtime-input'
import { bindVisualizationContextFilter } from '../pi-visualization-context'
import {
  cleanupNativeSessions,
  createNativeSession,
  createNativeTempDirectory,
  nativeCompactionFetch,
} from './pi-native-compaction-integration.test-utils'

describe('Pi compaction visualization context', () => {
  afterEach(cleanupNativeSessions)

  it('does not replay general context extensions while preparing compaction', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-context-count-')
    const contextEventCounter = { value: 0 }
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session } = await createNativeSession({
      directory,
      compactionEvents: [],
      contextEventCounter,
    })
    bindVisualizationContextFilter(session)

    await session.compact()

    expect(contextEventCounter.value).toBe(0)
  })

  it.each([
    { label: 'Native checkpoint', fallback: false },
    { label: '404 Portable fallback', fallback: true },
  ])(
    'keeps active visualization context through overflow retry via $label',
    async ({ fallback }) => {
      const directory = createNativeTempDirectory('openwaggle-overflow-visualization-context-')
      const nativeRequests: string[] = []
      const portableRequests: string[] = []
      const retryRequests: string[] = []
      const visualizationContext = [
        '[OpenWaggle inline visualization context]',
        'overflow retry selection',
        '[/OpenWaggle inline visualization context]',
      ].join('\n')
      const overflowResponse = fauxAssistantMessage('')
      overflowResponse.stopReason = 'error'
      overflowResponse.errorMessage = 'maximum context length exceeded'
      overflowResponse.timestamp = Date.now() + 60_000
      vi.stubGlobal(
        'fetch',
        fallback
          ? vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
              if (typeof init?.body === 'string') nativeRequests.push(init.body)
              return new Response(null, { status: 404 })
            })
          : nativeCompactionFetch(nativeRequests),
      )
      const responses: FauxResponseStep[] = [overflowResponse]
      if (fallback) {
        responses.push((context) => {
          portableRequests.push(JSON.stringify(context))
          return fauxAssistantMessage('Portable checkpoint')
        })
      }
      responses.push((context) => {
        retryRequests.push(JSON.stringify(context))
        return fauxAssistantMessage('Recovered after overflow')
      })
      const { session } = await createNativeSession({
        directory,
        compactionEvents: [],
        responses,
      })
      bindVisualizationContextFilter(session)

      await session.prompt(
        buildAtomicVisualizationPrompt(visualizationContext, 'Inspect during overflow retry'),
      )

      expect(nativeRequests).toHaveLength(1)
      expect(nativeRequests[0]).toContain('overflow retry selection')
      if (fallback) {
        expect(portableRequests).toHaveLength(1)
        expect(retryRequests).toHaveLength(1)
        expect(retryRequests[0]).toContain('overflow retry selection')
      }
    },
  )
})
