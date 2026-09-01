import { fauxAssistantMessage } from '@earendil-works/pi-ai'
import type { SessionCompactEvent } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAtomicVisualizationPrompt } from '../pi-runtime-input'
import { bindVisualizationContextFilter } from '../pi-visualization-context'
import {
  checkpointIds,
  cleanupNativeSessions,
  createNativeSession,
  createNativeTempDirectory,
  nativeCompactionFetch,
} from './pi-native-compaction-integration.test-utils'

describe('Pi repeated native compaction events', () => {
  afterEach(cleanupNativeSessions)

  it('emits the newly appended checkpoint for repeated manual compactions', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-manual-')
    const events: SessionCompactEvent[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      responses: [fauxAssistantMessage('More context')],
    })

    await session.compact()
    await session.prompt('Add context after the first checkpoint')
    await session.compact()

    expect(checkpointIds(events)).toEqual(['cmp_1', 'cmp_2'])
  })

  it('continues a native checkpoint through a credential-resolved endpoint', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-auth-url-')
    const events: SessionCompactEvent[] = []
    const requestBodies: string[] = []
    const authFailureState = { shouldFail: false }
    vi.stubGlobal('fetch', nativeCompactionFetch(requestBodies))
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      authBaseUrl: 'https://credentials.example.test/v1',
      authFailureState,
      responses: [fauxAssistantMessage('More context')],
    })

    await session.compact()
    await session.prompt('Add context after the first checkpoint')
    await session.compact()

    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[1]).toContain('cmp_1')

    const firstCheckpointEntry = events[0]?.compactionEntry
    expect(firstCheckpointEntry).toBeDefined()
    if (!firstCheckpointEntry) return
    authFailureState.shouldFail = true
    await session.navigateTree(firstCheckpointEntry.id)
    expect(JSON.stringify(session.messages)).toContain('cmp_1')
  })

  it('filters consumed visualization state before creating a native checkpoint', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-filter-context-')
    const events: SessionCompactEvent[] = []
    const requestBodies: string[] = []
    const visualizationContext = [
      '[OpenWaggle inline visualization context]',
      'transient selected service',
      '[/OpenWaggle inline visualization context]',
    ].join('\n')
    vi.stubGlobal('fetch', nativeCompactionFetch(requestBodies))
    const { session, sessionManager } = await createNativeSession({
      directory,
      compactionEvents: events,
      initialContext: buildAtomicVisualizationPrompt(
        visualizationContext,
        'Inspect the selected service',
      ),
    })
    sessionManager.appendMessage(fauxAssistantMessage('Inspection complete'))
    sessionManager.appendMessage({
      role: 'user',
      content: 'Continue without the old selection',
      timestamp: Date.now(),
    })
    bindVisualizationContextFilter(session)

    await session.compact()

    expect(requestBodies).toHaveLength(1)
    expect(requestBodies[0]).toContain('Inspect the selected service')
    expect(requestBodies[0]).toContain('Continue without the old selection')
    expect(requestBodies[0]).not.toContain('transient selected service')
  })

  it('emits the newly appended checkpoint for repeated automatic compactions', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-auto-')
    const events: SessionCompactEvent[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch())
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
      responses: [
        thresholdResponse(future),
        thresholdResponse(future + 1),
        fauxAssistantMessage('Complete'),
      ],
    })

    await session.prompt('first turn')
    await session.prompt('second turn')
    await session.prompt('third turn')

    expect(checkpointIds(events)).toEqual(['cmp_1', 'cmp_2'])
  })

  it('reserves the pending request before fitting raw checkpoint reconstruction', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-request-budget-')
    const events: SessionCompactEvent[] = []
    const authBaseUrlState = { value: 'https://endpoint-a.example.test/v1' }
    const providerContexts: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      authBaseUrlState,
      responses: [
        (context) => {
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Response after fitting request overhead')
        },
      ],
    })

    await session.compact()
    authBaseUrlState.value = 'https://endpoint-b.example.test/v1'
    await session.prompt('Mandatory pending request content')

    expect(providerContexts[0]).toContain('Mandatory pending request content')
    expect(providerContexts[0]).not.toContain('Initial context')
    expect(providerContexts[0]).not.toContain('cmp_1')
  })

  it('reprojects a native checkpoint before a direct prompt uses a changed endpoint', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-prompt-auth-')
    const events: SessionCompactEvent[] = []
    const authBaseUrlState = { value: 'https://endpoint-a.example.test/v1' }
    const providerContexts: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      contextWindow: 10_000,
      authBaseUrlState,
      responses: [
        (context) => {
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Response from endpoint B')
        },
      ],
    })

    await session.compact()
    authBaseUrlState.value = 'https://endpoint-b.example.test/v1'
    await session.prompt('Continue on endpoint B')

    expect(providerContexts).toHaveLength(1)
    expect(providerContexts[0]).toContain('Initial context')
    expect(providerContexts[0]).not.toContain('cmp_1')
  })

  it('returns from an auth endpoint override to the canonical model endpoint', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-auth-catalog-')
    const events: SessionCompactEvent[] = []
    const authBaseUrlState: { value: string | undefined } = {
      value: 'https://endpoint-a.example.test/v1',
    }
    const providerBaseUrls: string[] = []
    const providerContexts: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session, faux } = await createNativeSession({
      directory,
      compactionEvents: events,
      contextWindow: 10_000,
      authBaseUrlState,
      responses: [
        (context, _options, _state, model) => {
          providerBaseUrls.push(model.baseUrl)
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Response from catalog endpoint')
        },
      ],
    })

    await session.compact()
    authBaseUrlState.value = undefined
    await session.prompt('Return to the catalog endpoint')

    expect(providerBaseUrls).toEqual([faux.getModel().baseUrl])
    expect(providerContexts[0]).toContain('Initial context')
    expect(providerContexts[0]).not.toContain('cmp_1')
  })

  it('reprojects a checkpoint after provider reload changes the catalog endpoint', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-provider-reload-')
    const events: SessionCompactEvent[] = []
    const providerReloadState: { baseUrl: string | undefined; executed?: boolean } = {
      baseUrl: undefined,
    }
    const providerBaseUrls: string[] = []
    const providerContexts: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session, modelRuntime } = await createNativeSession({
      directory,
      compactionEvents: events,
      contextWindow: 10_000,
      providerReloadState,
      responses: [
        (context, _options, _state, model) => {
          providerBaseUrls.push(model.baseUrl)
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Response from reloaded provider')
        },
      ],
    })

    await session.compact()
    providerReloadState.baseUrl = 'https://endpoint-c.example.test/v1'
    await session.prompt('/reload-native-provider')
    expect(providerReloadState.executed).toBe(true)
    expect(modelRuntime.getModel('native-provider', 'native-model')?.baseUrl).toBe(
      providerReloadState.baseUrl,
    )
    await session.prompt('Continue after provider reload')

    expect(providerBaseUrls).toEqual([providerReloadState.baseUrl])
    expect(providerContexts[0]).toContain('Initial context')
    expect(providerContexts[0]).not.toContain('cmp_1')
  })

  it('reprojects a checkpoint when provider reload withdraws native compaction support', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-provider-capability-')
    const events: SessionCompactEvent[] = []
    const providerReloadState: {
      baseUrl: string | undefined
      supportsCompaction?: boolean
      executed?: boolean
    } = {
      baseUrl: undefined,
    }
    const providerContexts: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session, modelRuntime } = await createNativeSession({
      directory,
      compactionEvents: events,
      contextWindow: 10_000,
      providerReloadState,
      responses: [
        (context) => {
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Response without native compaction support')
        },
      ],
    })

    await session.compact()
    providerReloadState.supportsCompaction = false
    await session.prompt('/reload-native-provider')
    expect(providerReloadState.executed).toBe(true)
    const refreshedCompat = modelRuntime.getModel('native-provider', 'native-model')?.compat
    expect(
      refreshedCompat && 'supportsCompaction' in refreshedCompat
        ? refreshedCompat.supportsCompaction
        : undefined,
    ).toBe(false)
    await session.prompt('Continue after provider capability reload')

    expect(providerContexts[0]).toContain('Initial context')
    expect(providerContexts[0]).not.toContain('cmp_1')
  })
})
