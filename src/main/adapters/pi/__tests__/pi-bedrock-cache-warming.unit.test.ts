import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
} from '@earendil-works/pi-ai'
import { AMAZON_BEDROCK_MODELS } from '@earendil-works/pi-ai/providers/amazon-bedrock.models'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pi keeps a prompt cache entry warm while a Run waits on a long tool or `hive wait` (cache
 * warming `streaming`, OpenWaggle's default), from each model's `promptCache` lifetimes. The
 * generated Bedrock catalog declared none, so on Bedrock every tool call longer than five
 * minutes rewrote the whole prompt. Pi does not export its warmer, so the test loads Pi's module.
 */

const PI_CACHE_WARMER_MODULE = path.resolve(
  'node_modules/@earendil-works/pi-coding-agent/dist/core/cache-warmer.js',
)

interface WarmerStatus {
  readonly state: 'inactive' | 'scheduled' | 'refreshing'
  readonly reason?: string
  readonly nextWarmAt?: number
}

interface Warmer {
  readonly status: WarmerStatus
  start(
    request: { model: Model<Api>; context: Context; options: Record<string, unknown> },
    isCurrent: () => boolean,
  ): void
  cancel(): void
}

interface WarmerDependencies {
  readonly models: { streamSimple: (...args: unknown[]) => AssistantMessageEventStream }
  readonly sessionManager: { appendUsage: () => unknown; getBranch: () => unknown[] }
  readonly getMode: () => 'streaming'
}

async function createCacheWarmer(dependencies: WarmerDependencies): Promise<Warmer> {
  const piModule: unknown = await import(pathToFileURL(PI_CACHE_WARMER_MODULE).href)
  const CacheWarmer: unknown =
    typeof piModule === 'object' && piModule !== null
      ? Reflect.get(piModule, 'CacheWarmer')
      : undefined
  if (typeof CacheWarmer !== 'function') throw new Error('Pi cache warmer moved')
  const warmer: Warmer = Reflect.construct(CacheWarmer, [
    dependencies.models,
    dependencies.sessionManager,
    dependencies.getMode,
  ])
  return warmer
}

function reply(model: Model<Api>, prompt: number): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 1,
      cacheRead: prompt,
      cacheWrite: 0,
      totalTokens: prompt + 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 0,
  }
}

const PROMPT_TOKENS = 200_000
const CONTEXT: Context = { messages: [{ role: 'user', content: 'run the tests', timestamp: 0 }] }

async function startWarming(model: Model<Api>, options: Record<string, unknown> = {}) {
  const streamSimple = vi.fn((...args: unknown[]) => {
    const events = createAssistantMessageEventStream()
    const message = reply(model, PROMPT_TOKENS)
    events.push({ type: 'done', reason: 'stop', message })
    events.end(message)
    void args
    return events
  })
  const warmer = await createCacheWarmer({
    models: { streamSimple },
    sessionManager: {
      appendUsage: () => ({ type: 'usage' }),
      getBranch: () => [{ type: 'message', message: reply(model, PROMPT_TOKENS) }],
    },
    getMode: () => 'streaming',
  })
  warmer.start({ model, context: CONTEXT, options: { sessionId: 's', ...options } }, () => true)
  return { warmer, streamSimple }
}

const OPUS = AMAZON_BEDROCK_MODELS['eu.anthropic.claude-opus-5-5']
const HAIKU = AMAZON_BEDROCK_MODELS['eu.anthropic.claude-haiku-4-5-20251001-v1:0']

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Bedrock prompt cache lifetimes', () => {
  it('are declared for Claude models Bedrock caches', () => {
    expect(OPUS?.promptCache).toEqual({ short: 300, long: 3600 })
    expect(HAIKU?.promptCache).toEqual({ short: 300, long: 3600 })
    const nova = Object.values(AMAZON_BEDROCK_MODELS).find((model) => model.id.includes('nova'))
    expect(nova?.promptCache).toBeUndefined()
  })
})

describe('cache warming on Bedrock while a Run waits on a long tool', () => {
  it('replays the request with a one-token cap before the five-minute entry expires', async () => {
    if (!OPUS) throw new Error('Bedrock Opus 5.5 left the catalog')
    const { warmer, streamSimple } = await startWarming(OPUS, { reasoning: 'high' })

    expect(warmer.status.state).toBe('scheduled')
    await vi.advanceTimersByTimeAsync(269_000)
    expect(streamSimple).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(streamSimple).toHaveBeenCalledTimes(1)
    const [model, context, options] = streamSimple.mock.calls[0] ?? []
    expect(model).toBe(OPUS)
    expect(context).toBe(CONTEXT)
    expect(options).toMatchObject({ reasoning: 'high', maxTokens: 1, maxRetries: 0 })
    warmer.cancel()
  })

  it('warms a Bedrock Claude model a catalog listed without lifetimes', async () => {
    if (!OPUS) throw new Error('Bedrock Opus 5.5 left the catalog')
    const { promptCache: _promptCache, ...remote } = OPUS
    const { warmer } = await startWarming(remote)

    expect(warmer.status.state).toBe('scheduled')
    warmer.cancel()
  })

  it('does not replay budget-based thinking, whose budget follows the output cap', async () => {
    if (!HAIKU) throw new Error('Bedrock Haiku 4.5 left the catalog')
    const { warmer, streamSimple } = await startWarming(HAIKU, { reasoning: 'high' })

    expect(warmer.status).toMatchObject({
      state: 'inactive',
      reason: 'request cannot be replayed safely',
    })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(streamSimple).not.toHaveBeenCalled()
  })

  it('replays a budget-thinking model when the request does not think', async () => {
    if (!HAIKU) throw new Error('Bedrock Haiku 4.5 left the catalog')
    const { warmer } = await startWarming(HAIKU)

    expect(warmer.status.state).toBe('scheduled')
    warmer.cancel()
  })
})
