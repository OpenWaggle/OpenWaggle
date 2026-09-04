import type { Model } from '@earendil-works/pi-ai'
import { compactResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { describe, expect, it, vi } from 'vitest'
import { makeCompactResponse, makeNativeModel } from './pi-native-compaction-test-fixtures'

function codexModel(
  overrides: Partial<Model<'openai-codex-responses'>> = {},
): Model<'openai-codex-responses'> {
  return {
    ...makeNativeModel(),
    api: 'openai-codex-responses',
    provider: 'openai-codex',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    ...overrides,
  }
}

describe('Pi Codex native compaction headers', () => {
  it('preserves extension-provided Codex gateway headers', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        'https://api.openai.com/auth': { chatgpt_account_id: 'default-account' },
      }),
    ).toString('base64url')
    const accessToken = `header.${payload}.signature`
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer extension-token')
      expect(headers.get('chatgpt-account-id')).toBe('extension-account')
      expect(headers.get('originator')).toBe('extension-originator')
      expect(headers.get('openai-beta')).toBe('extension-beta')
      expect(headers.get('user-agent')).toBe('extension-agent')
      return makeCompactResponse([
        { type: 'compaction', id: 'cmp_headers', encrypted_content: 'opaque-checkpoint' },
      ])
    })

    await compactResponses(
      codexModel(),
      { systemPrompt: '', messages: [] },
      {
        apiKey: accessToken,
        headers: {
          Authorization: 'Bearer extension-token',
          'chatgpt-account-id': 'extension-account',
          originator: 'extension-originator',
          'OpenAI-Beta': 'extension-beta',
          'User-Agent': 'extension-agent',
        },
        fetch: fetchMock,
      },
    )
  })

  it('accepts header-only authentication for a Codex-compatible gateway', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer gateway-token')
      return makeCompactResponse([
        { type: 'compaction', id: 'cmp_gateway', encrypted_content: 'opaque-checkpoint' },
      ])
    })

    await compactResponses(
      codexModel({
        provider: 'custom-codex-gateway',
        baseUrl: 'https://gateway.example.test/codex',
      }),
      { systemPrompt: '', messages: [] },
      {
        headers: { Authorization: 'Bearer gateway-token' },
        fetch: fetchMock,
      },
    )
  })
})
