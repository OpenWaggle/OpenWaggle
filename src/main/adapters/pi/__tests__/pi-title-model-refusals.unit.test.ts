import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { SESSION_TITLE_MODEL_AUTOMATIC } from '@shared/session-title-model'
import { SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { createPiSessionTitleGenerator } from '../pi-session-title-generator'
import {
  isTitleModelRefusal,
  TITLE_MODEL_REFUSAL_COOLDOWN_MS,
  type TitleModelRefusal,
  TitleModelRefusals,
} from '../pi-title-model-refusals'

function model(id: string, input: number, output: number): Model<Api> {
  return fromPartial({
    id,
    provider: 'amazon-bedrock',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input, output, cacheRead: 0, cacheWrite: 0 },
    maxTokens: 8_192,
  })
}

describe('isTitleModelRefusal', () => {
  it.each([
    'AccessDeniedException: Model access is denied due to IAM user or service role is not authorized',
    '401 Unauthorized',
    "Token is expired. To refresh this SSO session run 'aws sso login' with the corresponding profile.",
    'Model not found: eu.anthropic.claude-haiku',
  ])('pauses the model for "%s"', (message) => {
    expect(isTitleModelRefusal(message)).toBe(true)
  })

  it.each(['503 Service Unavailable', '429 Too Many Requests', 'fetch failed'])(
    'lets "%s" pass',
    (message) => {
      expect(isTitleModelRefusal(message)).toBe(false)
    },
  )
})

describe('a Title model the provider refuses', () => {
  const HAIKU = model('eu.anthropic.claude-haiku', 1, 5)
  const OPUS = model('eu.anthropic.claude-opus', 15, 75)
  const DENIED =
    'AccessDeniedException: Model access is denied due to IAM user or service role is not authorized to perform the required AWS Marketplace actions'

  function bedrockRuntime(reply: (target: Model<Api>) => Promise<AssistantMessage>) {
    return fromPartial<ModelRuntime>({
      getModel: (_provider: string, id: string) =>
        [HAIKU, OPUS].find((candidate) => candidate.id === id),
      getAvailable: async () => [HAIKU, OPUS],
      completeSimple: vi.fn(reply),
    })
  }

  function setUp(reply: (target: Model<Api>) => Promise<AssistantMessage>) {
    let now = 1_000
    const notices: TitleModelRefusal[] = []
    const refusals = new TitleModelRefusals({
      now: () => now,
      notify: (refusal) => notices.push(refusal),
    })
    const runtime = bedrockRuntime(reply)
    const generator = createPiSessionTitleGenerator({
      modelRuntime: async () => ({ modelRuntime: runtime, release: () => undefined }),
      refusals,
    })
    const generate = (options: { readonly retryRefusedModels?: boolean } = {}) =>
      Effect.runPromise(
        Effect.either(
          generator.generate({
            projectPath: '/repo',
            sessionModel: SupportedModelId('amazon-bedrock/eu.anthropic.claude-opus'),
            titleModel: SESSION_TITLE_MODEL_AUTOMATIC,
            systemPrompt: 'Title it.',
            prompt: 'Hello',
            ...options,
          }),
        ),
      )
    const requestedModels = () =>
      vi.mocked(runtime.completeSimple).mock.calls.map(([target]) => target.id)
    return {
      generate,
      notices,
      requestedModels,
      advance: (milliseconds: number) => {
        now += milliseconds
      },
    }
  }

  const deniedForHaiku = async (target: Model<Api>) =>
    target.id === HAIKU.id
      ? fromPartial<AssistantMessage>({ stopReason: 'error', errorMessage: DENIED })
      : fromPartial<AssistantMessage>({
          stopReason: 'stop',
          content: [{ type: 'text', text: '{"title":"Opus title"}' }],
        })

  it('falls back to the Session model and skips the refused one for a while', async () => {
    const titles = setUp(deniedForHaiku)

    const first = await titles.generate()
    const second = await titles.generate()

    expect(first).toMatchObject({
      _tag: 'Right',
      right: { modelRef: 'amazon-bedrock/eu.anthropic.claude-opus' },
    })
    expect(second).toMatchObject({
      _tag: 'Right',
      right: { modelRef: 'amazon-bedrock/eu.anthropic.claude-opus' },
    })
    expect(titles.requestedModels()).toEqual([HAIKU.id, OPUS.id, OPUS.id])
  })

  it('tells the user once, naming the model and the reason', async () => {
    const titles = setUp(deniedForHaiku)

    await titles.generate()
    titles.advance(TITLE_MODEL_REFUSAL_COOLDOWN_MS + 1)
    await titles.generate()

    expect(titles.notices).toEqual([
      {
        model: 'amazon-bedrock/eu.anthropic.claude-haiku',
        reason: DENIED,
        retryAt: 1_000 + TITLE_MODEL_REFUSAL_COOLDOWN_MS,
      },
    ])
  })

  it('tries the refused model again once the pause is over', async () => {
    const titles = setUp(deniedForHaiku)

    await titles.generate()
    titles.advance(TITLE_MODEL_REFUSAL_COOLDOWN_MS + 1)
    await titles.generate()

    expect(titles.requestedModels()).toEqual([HAIKU.id, OPUS.id, HAIKU.id, OPUS.id])
  })

  it('tries it again when a person asks for a title', async () => {
    const titles = setUp(deniedForHaiku)

    await titles.generate()
    await titles.generate({ retryRefusedModels: true })

    expect(titles.requestedModels()).toEqual([HAIKU.id, OPUS.id, HAIKU.id, OPUS.id])
  })

  it('does not pause a model for a passing failure', async () => {
    const titles = setUp(async (target) =>
      target.id === HAIKU.id
        ? fromPartial<AssistantMessage>({
            stopReason: 'error',
            errorMessage: '503 Service Unavailable',
          })
        : fromPartial<AssistantMessage>({
            stopReason: 'stop',
            content: [{ type: 'text', text: '{"title":"Opus title"}' }],
          }),
    )

    await titles.generate()
    await titles.generate()

    expect(titles.requestedModels()).toEqual([HAIKU.id, OPUS.id, HAIKU.id, OPUS.id])
    expect(titles.notices).toEqual([])
  })
})
