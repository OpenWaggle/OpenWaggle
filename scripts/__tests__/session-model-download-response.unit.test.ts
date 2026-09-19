import { Response } from 'undici'
import { describe, expect, it, vi } from 'vitest'
import { fetchModelDownloadResponse } from '../session-model-download-response'

const MODEL_URL = 'https://huggingface.co/owner/model/resolve/pinned-revision/tokenizer.json'
const RETRY_DELAY_CASES: readonly [Readonly<Record<string, string>>, number][] = [
  [{ 'retry-after': '12' }, 12_000],
  [{ 'retry-after': 'Sat, 12 Sep 2026 14:00:12 GMT' }, 11_750],
  [{ ratelimit: '"resolvers";r=0;t=300' }, 300_000],
  [{ 'retry-after': '12', ratelimit: '"resolvers";r=0;t=300' }, 12_000],
]

describe('model download HTTP retries', () => {
  it('recovers from a transient rate limit without exposing its body as model content', async () => {
    const limited = new Response('rate limited', { status: 429 })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(limited)
      .mockResolvedValueOnce(new Response('model'))
    const wait = vi.fn().mockResolvedValue(undefined)

    const response = await fetchModelDownloadResponse(MODEL_URL, { fetch, wait })

    expect(await response.text()).toBe('model')
    expect(limited.bodyUsed).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledWith(1_000)
  })

  it.each(RETRY_DELAY_CASES)('honors the server retry delay %j', async (headers, expectedDelay) => {
    const limited = new Response('rate limited', { status: 429, headers })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(limited)
      .mockResolvedValueOnce(new Response('model'))
    const wait = vi.fn(async () => {
      expect(limited.bodyUsed).toBe(true)
    })
    const response = await fetchModelDownloadResponse(MODEL_URL, {
      fetch,
      wait,
      now: () => Date.parse('2026-09-12T14:00:00.250Z'),
    })

    expect(await response.text()).toBe('model')
    expect(wait).toHaveBeenCalledWith(expectedDelay)
  })

  it('does not start another request when a delayed wait resumes beyond the retry budget', async () => {
    let now = 0
    const fetch = vi.fn().mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
    const wait = vi.fn(async () => {
      now = 360_001
    })

    await expect(
      fetchModelDownloadResponse(MODEL_URL, { fetch, wait, now: () => now }),
    ).rejects.toThrow('HTTP 429')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([408, 429, 500, 502, 503, 504])(
    'bounds transient HTTP %i to five attempts',
    async (status) => {
      const responses: Response[] = []
      const fetch = vi.fn(async () => {
        const response = new Response('unavailable', { status })
        responses.push(response)
        return response
      })
      const wait = vi.fn().mockResolvedValue(undefined)

      await expect(fetchModelDownloadResponse(MODEL_URL, { fetch, wait })).rejects.toThrow(
        `HTTP ${status}`,
      )
      expect(fetch).toHaveBeenCalledTimes(5)
      expect(wait.mock.calls).toEqual([[1_000], [2_000], [4_000], [8_000]])
      expect(responses.every((response) => response.bodyUsed)).toBe(true)
    },
  )

  it.each([400, 401, 403, 404, 410, 501, 505])(
    'does not retry permanent HTTP %i',
    async (status) => {
      const response = new Response('permanent failure', { status })
      const fetch = vi.fn().mockResolvedValue(response)
      const wait = vi.fn().mockResolvedValue(undefined)

      await expect(fetchModelDownloadResponse(MODEL_URL, { fetch, wait })).rejects.toThrow(
        `HTTP ${status}`,
      )
      expect(response.bodyUsed).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(wait).not.toHaveBeenCalled()
    },
  )

  it.each(['-1', '1.5', 'tomorrow', '12, 90', '2026-09-12', 'Sat, 12 Sep 2026 14:00:00 GMT'])(
    'uses nonzero fallback for an invalid or past Retry-After %s',
    async (retryAfter) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('limited', {
            status: 429,
            headers: { 'retry-after': retryAfter },
          }),
        )
        .mockResolvedValueOnce(new Response('model'))
      const wait = vi.fn().mockResolvedValue(undefined)
      await fetchModelDownloadResponse(MODEL_URL, {
        fetch,
        wait,
        now: () => Date.parse('2026-09-12T14:00:00.250Z'),
      })
      expect(wait).toHaveBeenCalledWith(1_000)
    },
  )

  it.each([
    '"resolvers";r=0;t=-1',
    '"resolvers";r=0;t=1.5',
    '"resolvers";r=0;t=12;t=90',
    '"unknown";r=0;t=20',
  ])('does not misread malformed RateLimit %s', async (rateLimit) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('limited', {
          status: 429,
          headers: { ratelimit: rateLimit },
        }),
      )
      .mockResolvedValueOnce(new Response('model'))
    const wait = vi.fn().mockResolvedValue(undefined)
    await fetchModelDownloadResponse(MODEL_URL, { fetch, wait })
    expect(wait).toHaveBeenCalledWith(1_000)
  })

  it.each(['361', '9'.repeat(400), 'Sat, 12 Sep 2026 14:10:00 GMT'])(
    'fails rather than shortening a server delay outside the budget: %s',
    async (retryAfter) => {
      const limited = new Response('limited', {
        status: 429,
        headers: { 'retry-after': retryAfter },
      })
      const fetch = vi.fn().mockResolvedValue(limited)
      const wait = vi.fn().mockResolvedValue(undefined)
      await expect(
        fetchModelDownloadResponse(MODEL_URL, {
          fetch,
          wait,
          now: () => Date.parse('2026-09-12T14:00:00Z'),
        }),
      ).rejects.toThrow('HTTP 429')
      expect(limited.bodyUsed).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(wait).not.toHaveBeenCalled()
    },
  )

  it('honors the cumulative wait budget even if the clock does not advance', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('limited', {
          status: 429,
          headers: { ratelimit: '"resolvers";r=0;t=300' },
        }),
    )
    const wait = vi.fn().mockResolvedValue(undefined)
    await expect(
      fetchModelDownloadResponse(MODEL_URL, { fetch, wait, now: () => 0 }),
    ).rejects.toThrow('HTTP 429')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(wait.mock.calls).toEqual([[300_000]])
  })

  it('does not retry unknown transport failures', async () => {
    const failure = new Error('transport failed')
    const fetch = vi.fn().mockRejectedValue(failure)
    const wait = vi.fn().mockResolvedValue(undefined)
    await expect(fetchModelDownloadResponse(MODEL_URL, { fetch, wait })).rejects.toBe(failure)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })

  it('waits for cancellation to settle before retrying', async () => {
    const events: string[] = []
    const body = new ReadableStream({
      cancel: async () => {
        await Promise.resolve()
        events.push('cancelled')
      },
    })
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(body, { status: 429 }))
      .mockImplementationOnce(async () => {
        events.push('fetch')
        return new Response('model')
      })
    const wait = async () => {
      events.push('wait')
    }
    await fetchModelDownloadResponse(MODEL_URL, { fetch, wait })
    expect(events).toEqual(['cancelled', 'wait', 'fetch'])
  })

  it('fails closed when the failed response body cannot be cancelled', async () => {
    const failure = new Error('cancel failed')
    const body = new ReadableStream({
      cancel: () => {
        throw failure
      },
    })
    const fetch = vi.fn().mockResolvedValue(new Response(body, { status: 429 }))
    const wait = vi.fn().mockResolvedValue(undefined)
    await expect(fetchModelDownloadResponse(MODEL_URL, { fetch, wait })).rejects.toBe(failure)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })
})
