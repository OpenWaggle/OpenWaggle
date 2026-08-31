import type { Context } from '@earendil-works/pi-ai'
import { compactResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { compact } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeCompactResponse,
  makeNativeModel,
  makePreparation,
  NATIVE_DETAILS,
} from './pi-native-compaction-test-fixtures'

describe('Pi Responses native compaction transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the public compact endpoint and returns its canonical replacement items', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'native-model',
        instructions: 'System instructions',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Keep this context' }],
          },
        ],
      })
      return makeCompactResponse([
        { role: 'user', content: [{ type: 'input_text', text: 'Keep this context' }] },
        { type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-checkpoint' },
      ])
    })
    const model = makeNativeModel({
      compat: {
        supportsCompaction: true,
        compactionBaseUrl: 'https://compaction.example.test/v1',
      },
    })
    const context: Context = {
      systemPrompt: 'System instructions',
      messages: [{ role: 'user', content: 'Keep this context', timestamp: 1 }],
    }

    const result = await compactResponses(model, context, {
      apiKey: 'test-key',
      fetch: fetchMock,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://compaction.example.test/v1/responses/compact',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.output.at(-1)).toEqual({
      type: 'compaction',
      id: 'cmp_1',
      encrypted_content: 'opaque-checkpoint',
    })
  })

  it('persists a versioned opaque envelope without invoking Portable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        makeCompactResponse([
          { type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-checkpoint' },
        ]),
      ),
    )
    const portableStream = vi.fn(() => {
      throw new Error('Portable must not run')
    })

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
      undefined,
      undefined,
      'session-1',
      'System instructions',
    )

    expect(portableStream).not.toHaveBeenCalled()
    expect(result.firstKeptEntryId).toBe('native-replacement')
    expect(result.details).toEqual(NATIVE_DETAILS)
  })

  it.each([
    {
      name: 'propagates an endpoint failure',
      response: () => makeCompactResponse([], 400),
      expected: 'native endpoint unavailable',
    },
    {
      name: 'rejects a malformed replacement window',
      response: () => makeCompactResponse([]),
      expected: 'valid compaction item',
    },
  ])('$name without silently invoking Portable', async ({ response, expected }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response()),
    )
    const portableStream = vi.fn(() => {
      throw new Error('Portable must not run')
    })

    await expect(
      compact(
        makePreparation(),
        makeNativeModel(),
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
      ),
    ).rejects.toThrow(expected)
    expect(portableStream).not.toHaveBeenCalled()
  })
})
