import { fauxAssistantMessage } from '@earendil-works/pi-ai'
import type { ExtensionFactory, SessionCompactEvent } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupOpenWagglePiSessions,
  createOpenWagglePiSession,
} from './openwaggle-pi-session.test-support'
import {
  cleanupNativeSessions,
  createNativeSession,
  createNativeTempDirectory,
  nativeCompactionFetch,
} from './pi-native-compaction-integration.test-utils'
import { autoRouterExtension } from './virtual-model.test-support'

const MODELS = [{ id: 'luna', name: 'Luna', contextWindow: 200_000, maxTokens: 10_000 }]

/** Routes `router/auto` to the session's native-capable Responses model. */
const nativeRouter: ExtensionFactory = (pi) => {
  pi.registerVirtualModel({
    provider: 'router',
    id: 'auto',
    name: 'Auto',
    thinkingLevels: ['low'],
    route: (_request, ctx) => {
      const model = ctx.modelRegistry.find('native-provider', 'native-model')
      if (!model) throw new Error('The test router cannot find native-provider/native-model')
      return {
        model: { ...model, compat: { ...model.compat, supportsCompaction: true } },
        thinkingLevel: 'low',
      }
    },
  })
}

afterEach(async () => {
  await cleanupOpenWagglePiSessions()
  cleanupNativeSessions()
  vi.unstubAllGlobals()
})

describe('compaction under a virtual model selection', () => {
  it('compacts with the portable mechanism and keeps the virtual selection', async () => {
    const { session, faux } = await createOpenWagglePiSession({
      models: MODELS,
      extensionFactories: [autoRouterExtension('luna')],
      selectedModel: { provider: 'router', id: 'auto' },
      piGlobalSettings: { compaction: { keepRecentTokens: 100 } },
    })
    faux.setResponses([
      fauxAssistantMessage('one'),
      fauxAssistantMessage('two'),
      fauxAssistantMessage('summary text'),
      fauxAssistantMessage('after'),
    ])
    await session.prompt('Hello '.repeat(2000))
    await session.prompt('More '.repeat(2000))

    const result = await session.compact()

    expect(result.details).not.toMatchObject({ mechanism: 'native' })
    expect(session.model).toMatchObject({ provider: 'router', id: 'auto' })
    await session.prompt('Next')
    expect(session.messages.at(-1)).toMatchObject({ provider: 'test-provider', model: 'luna' })
  })

  it('never calls the Native endpoint when the router picks a native-capable model', async () => {
    const directory = createNativeTempDirectory('openwaggle-virtual-native-')
    const compactionEvents: SessionCompactEvent[] = []
    const nativeBodies: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch(nativeBodies))
    const { session, modelRuntime } = await createNativeSession({
      directory,
      compactionEvents,
      extensionFactories: [nativeRouter],
      contextWindow: 100_000,
      responses: [
        fauxAssistantMessage('a1'),
        fauxAssistantMessage('portable summary'),
        fauxAssistantMessage('a2'),
      ],
    })
    await modelRuntime.setRuntimeApiKey('native-provider', 'test-key')
    await session.prompt('First message')
    const auto = modelRuntime.getModel('router', 'auto')
    if (!auto) throw new Error('The router did not register router/auto')
    await session.setModel(auto)

    const result = await session.compact()

    expect(nativeBodies).toHaveLength(0)
    expect(result.details).not.toMatchObject({ mechanism: 'native' })
    expect(session.model).toMatchObject({ provider: 'router', id: 'auto' })
  })
})
