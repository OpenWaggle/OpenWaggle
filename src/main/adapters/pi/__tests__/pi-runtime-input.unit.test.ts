import type { Model } from '@earendil-works/pi-ai'
import type { HydratedAgentSendPayload } from '@shared/types/agent'
import { describe, expect, it } from 'vitest'
import { buildPiPromptInput } from '../pi-runtime-input'

function makeModel(
  id: string,
  input: Model<'openai-responses'>['input'],
): Model<'openai-responses'> {
  return {
    id,
    provider: 'test-provider',
    baseUrl: 'https://example.test',
    api: 'openai-responses',
    name: id === 'image-model' ? 'Image Model' : 'Text Model',
    reasoning: false,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
  }
}

function makeModels() {
  return {
    image: makeModel('image-model', ['text', 'image']),
    text: makeModel('text-model', ['text']),
  }
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
    const models = makeModels()
    const result = buildPiPromptInput(models.image, makePayload())

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
    const models = makeModels()
    const result = buildPiPromptInput(models.text, makePayload())

    expect(result.images).toEqual([])
    expect(result.text).toContain('[Attachment: diagram.png]')
    expect(result.text).toContain('Architecture diagram')
  })

  it('supports attachment-only prompts', () => {
    const models = makeModels()
    const result = buildPiPromptInput(models.image, makePayload({ text: '   ' }))

    expect(result.text).toContain('[Attachment: diagram.png]')
    expect(result.text.length).toBeGreaterThan(0)
  })
})
