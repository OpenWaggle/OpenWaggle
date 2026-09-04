import { compact } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeCompactResponse,
  makeNativeModel,
  makePreparation,
} from './pi-native-compaction-test-fixtures'

describe('Pi Native compaction retry policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([408, 409])('retries transport-classified HTTP %i failures', async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(undefined, {
          status,
          statusText: status === 408 ? 'Request Timeout' : 'Conflict',
          headers: { 'retry-after-ms': '1' },
        }),
      )
      .mockResolvedValueOnce(
        makeCompactResponse([
          { type: 'compaction', id: 'cmp_retry', encrypted_content: 'opaque-checkpoint' },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)

    await compact(
      makePreparation(),
      makeNativeModel(),
      'test-key',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { enabled: true, maxRetries: 2, baseDelayMs: 1 },
      undefined,
      'session-1',
      'System instructions',
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
