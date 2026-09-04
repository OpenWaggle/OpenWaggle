import { type AssistantMessage, createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { compact, prepareCompaction, SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMPACTION_SETTINGS,
  makeAssistant,
  makeCompactResponse,
  makeNativeModel,
  makePreparation,
  NATIVE_DETAILS,
} from './pi-native-compaction-test-fixtures'

const PORTABLE_RESPONSE: AssistantMessage = {
  ...makeAssistant('Portable handoff after unavailable Native endpoint', 2),
  usage: {
    input: 100,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 110,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
}

function createPortableStream(response: AssistantMessage = PORTABLE_RESPONSE) {
  return vi.fn(() => {
    const stream = createAssistantMessageEventStream()
    stream.end(response)
    return stream
  })
}

async function compactNative(
  portableStream: NonNullable<Parameters<typeof compact>[7]>,
  signal?: AbortSignal,
) {
  return compact(
    makePreparation(),
    makeNativeModel(),
    'test-key',
    undefined,
    undefined,
    signal,
    undefined,
    portableStream,
    undefined,
    { enabled: false, maxRetries: 0, baseDelayMs: 0 },
    undefined,
    'session-1',
    'System instructions',
  )
}

describe('Pi Native endpoint fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([404, 405, 501])(
    'uses Portable when the declared Native endpoint returns %i',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => makeCompactResponse([], status)),
      )
      const portableStream = createPortableStream()

      const result = await compactNative(portableStream)

      expect(portableStream).toHaveBeenCalledOnce()
      expect(result.summary).toContain('Portable handoff after unavailable Native endpoint')
      expect(result.details).toMatchObject({ mechanism: 'portable', contract: 'codex-handoff-v1' })
    },
  )

  it('falls back after one request when a 501 endpoint is unavailable and retries are enabled', async () => {
    const nativeFetch = vi.fn(async () => makeCompactResponse([], 501))
    vi.stubGlobal('fetch', nativeFetch)
    const portableStream = createPortableStream()

    const result = await compact(
      makePreparation(),
      makeNativeModel(),
      'test-key',
      undefined,
      undefined,
      undefined,
      undefined,
      portableStream,
      undefined,
      { enabled: true, maxRetries: 3, baseDelayMs: 0 },
      undefined,
      'session-1',
      'System instructions',
    )

    expect(nativeFetch).toHaveBeenCalledOnce()
    expect(portableStream).toHaveBeenCalledOnce()
    expect(result.details).toMatchObject({ mechanism: 'portable' })
  })

  it('reconstructs authoritative raw history after a prior Native checkpoint', async () => {
    const sessionManager = SessionManager.inMemory('/repo')
    sessionManager.appendMessage({
      role: 'user',
      content: 'raw context that predates the opaque checkpoint',
      timestamp: 1,
    })
    sessionManager.appendMessage(makeAssistant('old response', 2))
    sessionManager.appendCompaction(
      'Native compaction checkpoint',
      'native-replacement',
      80_000,
      NATIVE_DETAILS,
    )
    sessionManager.appendMessage({ role: 'user', content: 'recent request', timestamp: 3 })
    sessionManager.appendMessage(makeAssistant('recent response', 4))
    const model = makeNativeModel()
    const preparation = prepareCompaction(
      sessionManager.getBranch(),
      { ...COMPACTION_SETTINGS, keepRecentTokens: 1 },
      model,
    )
    if (!preparation) throw new Error('Expected compaction preparation')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeCompactResponse([], 404)),
    )
    const portablePrompts: string[] = []
    const portableStream = vi.fn((_model, context) => {
      portablePrompts.push(JSON.stringify(context))
      const stream = createAssistantMessageEventStream()
      stream.end({
        ...PORTABLE_RESPONSE,
        content: [{ type: 'text', text: 'Portable handoff preserving the raw context' }],
      })
      return stream
    })

    const result = await compact(
      preparation,
      model,
      'test-key',
      undefined,
      undefined,
      undefined,
      undefined,
      portableStream,
      undefined,
      { enabled: false, maxRetries: 0, baseDelayMs: 0 },
      undefined,
      'session-1',
      'System instructions',
    )

    expect(portableStream).toHaveBeenCalled()
    expect(portablePrompts.some((prompt) => prompt.includes('raw context that predates'))).toBe(
      true,
    )
    expect(portablePrompts.join('\n')).not.toContain('opaque-checkpoint')
    expect(result.summary).toContain('Portable handoff preserving the raw context')
    expect(result.details).toMatchObject({ mechanism: 'portable', contract: 'codex-handoff-v1' })
  })

  it.each([400, 401, 429, 500])(
    'does not hide Native endpoint status %i behind Portable',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => makeCompactResponse([], status)),
      )
      const portableStream = createPortableStream()

      await expect(compactNative(portableStream)).rejects.toThrow('native endpoint unavailable')
      expect(portableStream).not.toHaveBeenCalled()
    },
  )

  it('does not fall back after cancellation wins the Native response race', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort()
        return makeCompactResponse([], 404)
      }),
    )
    const portableStream = createPortableStream()

    await expect(compactNative(portableStream, controller.signal)).rejects.toThrow()
    expect(portableStream).not.toHaveBeenCalled()
  })
})
