import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'
import type { HydratedAgentSendPayload } from '@shared/types/agent'
import { describe, expect, it } from 'vitest'
import type { PiModel } from '../pi-provider-catalog'
import { buildPiPromptInput } from '../pi-runtime-input'

function makeRegistry(): ModelRegistry {
  const authStorage = AuthStorage.inMemory()
  const modelRegistry = ModelRegistry.inMemory(authStorage)
  modelRegistry.registerProvider('test-provider', {
    api: 'openai-responses',
    baseUrl: 'https://example.test',
    apiKey: 'TEST_PROVIDER_API_KEY',
    models: [
      {
        id: 'image-model',
        name: 'Image Model',
        api: 'openai-responses',
        reasoning: false,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
      },
      {
        id: 'text-model',
        name: 'Text Model',
        api: 'openai-responses',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
      },
    ],
  })
  return modelRegistry
}

function requireModel(modelRegistry: ModelRegistry, modelId: string): PiModel {
  const model = modelRegistry.find('test-provider', modelId)
  if (!model) {
    throw new Error(`Missing test model ${modelId}`)
  }
  return model
}

function makePayload(overrides?: Partial<HydratedAgentSendPayload>): HydratedAgentSendPayload {
  return {
    text: 'Inspect these files',
    thinkingLevel: 'medium',
    attachments: [
      {
        id: 'img-1',
        kind: 'image',
        name: 'diagram.png',
        path: '/tmp/diagram.png',
        mimeType: 'image/png',
        sizeBytes: 128,
        extractedText: 'Architecture diagram',
        source: {
          type: 'data',
          value: 'base64-image',
          mimeType: 'image/png',
        },
      },
      {
        id: 'doc-1',
        kind: 'pdf',
        name: 'spec.pdf',
        path: '/tmp/spec.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 256,
        extractedText: 'Detailed migration spec',
        source: null,
      },
    ],
    ...overrides,
  }
}

describe('buildPiPromptInput', () => {
  it('includes image attachments as Pi images when the selected Pi model supports them', () => {
    const modelRegistry = makeRegistry()
    const result = buildPiPromptInput(requireModel(modelRegistry, 'image-model'), makePayload())

    expect(result.images).toEqual([
      {
        type: 'image',
        data: 'base64-image',
        mimeType: 'image/png',
      },
    ])
    expect(result.text).toContain('Inspect these files')
    expect(result.text).toContain('[Attachment: diagram.png]')
    expect(result.text).toContain('Detailed migration spec')
  })

  it('keeps attachment summaries in text when the selected Pi model is text-only', () => {
    const modelRegistry = makeRegistry()
    const result = buildPiPromptInput(requireModel(modelRegistry, 'text-model'), makePayload())

    expect(result.images).toEqual([])
    expect(result.text).toContain('[Attachment: diagram.png]')
    expect(result.text).toContain('Architecture diagram')
  })

  it('supports attachment-only prompts', () => {
    const modelRegistry = makeRegistry()
    const result = buildPiPromptInput(
      requireModel(modelRegistry, 'image-model'),
      makePayload({ text: '   ' }),
    )

    expect(result.text).toContain('[Attachment: diagram.png]')
    expect(result.text.length).toBeGreaterThan(0)
  })
})
