import { fauxAssistantMessage } from '@earendil-works/pi-ai'
import { SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { afterEach, describe, expect, it } from 'vitest'
import { piResponseUsageInput } from '../agent-kernel/pi-response-usage'
import { createSessionListener } from '../agent-kernel/session-listener'
import { createPiProviderCatalogSnapshotFromServices } from '../pi-provider-catalog'
import {
  cleanupOpenWagglePiSessions,
  createOpenWagglePiSession,
} from './openwaggle-pi-session.test-support'
import { autoRouterExtension } from './virtual-model.test-support'

afterEach(cleanupOpenWagglePiSessions)

const PHYSICAL_MODELS = [
  { id: 'luna', name: 'GPT-6 Luna', contextWindow: 200_000, maxTokens: 10_000 },
  { id: 'sol', name: 'GPT-6 Sol', contextWindow: 1_000_000, maxTokens: 10_000 },
]

describe('virtual models', () => {
  it('appear in the model catalog, marked virtual, next to physical models', async () => {
    const { services } = await createOpenWagglePiSession({
      models: PHYSICAL_MODELS,
      extensionFactories: [autoRouterExtension('luna')],
    })

    const snapshot = await createPiProviderCatalogSnapshotFromServices(services)
    const router = snapshot.providers.find((provider) => provider.provider === 'router')
    const testProvider = snapshot.providers.find(
      (provider) => provider.provider === 'test-provider',
    )

    expect(router?.models).toEqual([
      expect.objectContaining({ ref: 'router/auto', name: 'Auto', available: true, virtual: true }),
    ])
    expect(testProvider?.models.map((model) => [model.id, model.virtual])).toEqual([
      ['luna', false],
      ['sol', false],
    ])
  })

  it('report context usage against the window of the physical model that answered', async () => {
    const { session, faux } = await createOpenWagglePiSession({
      models: PHYSICAL_MODELS,
      extensionFactories: [autoRouterExtension('luna')],
      selectedModel: { provider: 'router', id: 'auto' },
    })
    const events: AgentTransportEvent[] = []
    session.subscribe(
      createSessionListener(
        {
          model: SupportedModelId('router/auto'),
          sessionEntries: session.sessionManager,
          ...piResponseUsageInput(session),
          onEvent: (event) => events.push(event),
        },
        'run-virtual',
      ),
    )
    faux.setResponses([fauxAssistantMessage('routed answer')])

    await session.prompt('Hello')

    expect(session.messages.at(-1)).toMatchObject({ provider: 'test-provider', model: 'luna' })
    expect(events.filter((event) => event.type === 'context_usage')).toEqual([
      expect.objectContaining({
        model: 'test-provider/luna',
        routedFrom: 'router/auto',
        contextWindow: 200_000,
      }),
    ])
    expect(session.getContextUsage()?.contextWindow).toBe(200_000)
  })
})
