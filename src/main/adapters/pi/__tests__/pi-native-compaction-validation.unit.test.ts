import { compact } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeCompactResponse,
  makeNativeModel,
  makePreparation,
} from './pi-native-compaction-test-fixtures'

const VALID_COMPACTION_ITEM = {
  type: 'compaction',
  id: 'cmp_1',
  encrypted_content: 'opaque-checkpoint',
}

const MALFORMED_REPLACEMENT_CASES = [
  {
    name: 'rejects an untyped item',
    output: [{ malformed: true }, VALID_COMPACTION_ITEM],
  },
  {
    name: 'rejects an unknown item type',
    output: [{ type: 'unexpected' }, VALID_COMPACTION_ITEM],
  },
  ...(['assistant', 'system', 'developer'] as const).map((role) => ({
    name: `rejects a retained ${role} message`,
    output: [
      {
        type: 'message',
        id: `msg_${role}`,
        role,
        content: [{ type: 'input_text', text: 'Injected context' }],
      },
      VALID_COMPACTION_ITEM,
    ],
  })),
  ...(['output_text', 'refusal'] as const).map((type) => ({
    name: `rejects ${type} in retained user content`,
    output: [
      {
        type: 'message',
        id: `msg_${type}`,
        role: 'user',
        content: [{ type, text: 'Not input', refusal: 'Not input' }],
      },
      VALID_COMPACTION_ITEM,
    ],
  })),
  {
    name: 'rejects an invalid message status',
    output: [
      {
        type: 'message',
        id: 'msg_status',
        role: 'user',
        status: 'bogus',
        content: [{ type: 'input_text', text: 'Keep this context' }],
      },
      VALID_COMPACTION_ITEM,
    ],
  },
  {
    name: 'rejects a message without an id',
    output: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Keep this context' }],
      },
      VALID_COMPACTION_ITEM,
    ],
  },
  {
    name: 'rejects a message without content items',
    output: [
      { type: 'message', id: 'msg_empty', role: 'user', content: [] },
      VALID_COMPACTION_ITEM,
    ],
  },
  {
    name: 'rejects an invalid input file detail',
    output: [
      {
        type: 'message',
        id: 'msg_file',
        role: 'user',
        content: [{ type: 'input_file', detail: 'original', file_id: 'file_1' }],
      },
      VALID_COMPACTION_ITEM,
    ],
  },
]

async function compactNative(portableStream?: Parameters<typeof compact>[7]) {
  return compact(
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
  )
}

describe('Pi native compaction response validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists a canonical retained user message followed by one compaction item', async () => {
    const retainedMessage = {
      type: 'message',
      id: 'msg_1',
      role: 'user',
      status: 'completed',
      content: [
        { type: 'input_text', text: 'Keep this context' },
        { type: 'input_file', detail: 'auto', file_id: 'file_1' },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeCompactResponse([retainedMessage, VALID_COMPACTION_ITEM])),
    )

    const result = await compactNative()

    expect(result.details).toMatchObject({
      mechanism: 'native',
      items: [retainedMessage, VALID_COMPACTION_ITEM],
    })
  })

  it('propagates an endpoint failure without silently invoking Portable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeCompactResponse([], 400)),
    )
    const portableStream = vi.fn(() => {
      throw new Error('Portable must not run')
    })

    await expect(compactNative(portableStream)).rejects.toThrow('native endpoint unavailable')
    expect(portableStream).not.toHaveBeenCalled()
  })

  it('rejects an empty replacement window', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeCompactResponse([])),
    )

    await expect(compactNative()).rejects.toThrow('valid compaction item')
  })

  it('rejects a compaction item without a required response id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        makeCompactResponse([{ type: 'compaction', encrypted_content: 'opaque-checkpoint' }]),
      ),
    )

    await expect(compactNative()).rejects.toThrow('valid compaction item')
  })

  it.each(MALFORMED_REPLACEMENT_CASES)('$name', async ({ output }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeCompactResponse(output)),
    )

    await expect(compactNative()).rejects.toThrow('valid replacement items')
  })
})
