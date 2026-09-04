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

  it('applies general provider context filters while preparing Native compaction', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-context-count-')
    const contextEventCounter = { value: 0 }
    const nativeRequests: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch(nativeRequests))
    const { session, sessionManager } = await createNativeSession({
      directory,
      compactionEvents: [],
      contextEventCounter,
      initialContext: 'PUBLIC-CONTEXT',
      contextTransform: (messages) =>
        messages.filter(
          (message) => message.role !== 'user' || !String(message.content).includes('SECRET'),
        ),
    })
    sessionManager.appendMessage({
      role: 'user',
      content: 'SECRET-CONTEXT',
      timestamp: 2,
    })
    bindVisualizationContextFilter(session)

    await session.compact()

    expect(contextEventCounter.value).toBe(1)
    expect(nativeRequests[0]).toContain('PUBLIC-CONTEXT')
    expect(nativeRequests[0]).not.toContain('SECRET-CONTEXT')
  })

  it('blocks images from Native compaction with the same provider-facing conversion', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-block-images-')
    const nativeRequests: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch(nativeRequests))
    const { session, sessionManager } = await createNativeSession({
      directory,
      compactionEvents: [],
      blockImages: true,
    })
    sessionManager.appendMessage({
      role: 'user',
      content: [
        { type: 'text', text: 'Image context' },
        { type: 'image', data: 'c2Vuc2l0aXZlLWltYWdl', mimeType: 'image/png' },
      ],
      timestamp: 2,
    })

    await session.compact()

    expect(nativeRequests[0]).toContain('Image reading is disabled.')
    expect(nativeRequests[0]).not.toContain('c2Vuc2l0aXZlLWltYWdl')
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
