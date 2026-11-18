import { writeFileSync } from 'node:fs'
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupNativeSessions,
  createNativeSession,
  createNativeTempDirectory,
  nativeCompactionFetch,
} from './pi-native-compaction-integration.test-utils'

describe('Pi Native compaction tool-loop auth', () => {
  afterEach(cleanupNativeSessions)

  it('reuses the prepared provider credential for mid-tool-loop compaction', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-tool-loop-auth-')
    writeFileSync(`${directory}/large.txt`, `large-tool-result-${'z'.repeat(4_000)}`, 'utf8')
    let headerCalls = 0
    const compactionHeaders: string[] = []
    const continuationContexts: string[] = []
    const compact = nativeCompactionFetch()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        compactionHeaders.push(new Headers(init?.headers).get('authorization') ?? '')
        return compact(input, init)
      }),
    )
    const { session } = await createNativeSession({
      directory,
      compactionEvents: [],
      contextWindow: 1_000,
      systemPrompt: 'Tool-loop auth test',
      enableDefaultTools: true,
      providerAuthHeaderResolver: () => `Bearer rotating-${++headerCalls}`,
      responses: [
        fauxAssistantMessage(fauxToolCall('read', { path: 'large.txt' }, { id: 'tool-large' }), {
          stopReason: 'toolUse',
        }),
        (context) => {
          continuationContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Tool loop complete')
        },
      ],
    })

    await session.prompt('Read the large file')

    expect(headerCalls).toBe(2)
    expect(compactionHeaders).toEqual(['Bearer rotating-2'])
    expect(continuationContexts[0]).toContain('cmp_1')
  })
})
