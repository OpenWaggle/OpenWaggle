import type { AgentSendPayload } from '@shared/types/agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Use vi.hoisted to avoid hoisting issues with vi.mock factories
const mockGetProviderForModel = vi.hoisted(() => vi.fn())
const mockIsKnownModel = vi.hoisted(() => vi.fn())

vi.mock('../providers', () => ({
  providerRegistry: {
    getProviderForModel: mockGetProviderForModel,
    isKnownModel: mockIsKnownModel,
  },
}))

describe('shared agent helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('makeMessage', () => {
    it('creates a message with required fields', async () => {
      const { makeMessage } = await import('./shared')
      const msg = makeMessage('user', [{ type: 'text', text: 'hello' }])
      expect(msg.role).toBe('user')
      expect(msg.parts).toEqual([{ type: 'text', text: 'hello' }])
      expect(msg.id).toBeTruthy()
      expect(msg.createdAt).toBeGreaterThan(0)
    })

    it('includes optional model and metadata', async () => {
      const { makeMessage } = await import('./shared')
      const msg = makeMessage('assistant', [{ type: 'text', text: 'hi' }], 'gpt-4.1-mini', {
        orchestrationRunId: 'run-1',
      })
      expect(msg.model).toBe('gpt-4.1-mini')
      expect(msg.metadata?.orchestrationRunId).toBe('run-1')
    })
  })

  describe('buildPersistedUserMessageParts', () => {
    it('builds text parts from payload', async () => {
      const { buildPersistedUserMessageParts } = await import('./shared')
      const payload: AgentSendPayload = {
        text: '  hello world  ',
        qualityPreset: 'medium',
        attachments: [],
      }
      const parts = buildPersistedUserMessageParts(payload)
      expect(parts).toEqual([{ type: 'text', text: 'hello world' }])
    })

    it('returns empty text part for empty payload', async () => {
      const { buildPersistedUserMessageParts } = await import('./shared')
      const payload: AgentSendPayload = {
        text: '   ',
        qualityPreset: 'medium',
        attachments: [],
      }
      const parts = buildPersistedUserMessageParts(payload)
      expect(parts).toEqual([{ type: 'text', text: '' }])
    })

    it('strips binary source from attachments', async () => {
      const { buildPersistedUserMessageParts } = await import('./shared')
      const payload: AgentSendPayload = {
        text: 'check this',
        qualityPreset: 'medium',
        attachments: [
          {
            id: 'att-1',
            kind: 'image',
            name: 'photo.png',
            path: '/tmp/photo.png',
            mimeType: 'image/png',
            sizeBytes: 1024,
            extractedText: '',
            source: { type: 'data', value: 'base64data', mimeType: 'image/png' },
          },
        ],
      }
      const parts = buildPersistedUserMessageParts(payload)
      expect(parts).toHaveLength(2)
      expect(parts[1]).toEqual({
        type: 'attachment',
        attachment: {
          id: 'att-1',
          kind: 'image',
          name: 'photo.png',
          path: '/tmp/photo.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          extractedText: '',
        },
      })
    })
  })

  describe('buildSamplingOptions', () => {
    it('omits topP when undefined', async () => {
      const { buildSamplingOptions } = await import('./shared')
      const result = buildSamplingOptions({
        temperature: 0.4,
      })
      expect(result).toEqual({ temperature: 0.4 })
      expect('topP' in result).toBe(false)
    })

    it('includes topP when defined', async () => {
      const { buildSamplingOptions } = await import('./shared')
      const result = buildSamplingOptions({
        temperature: 0.4,
        topP: 0.95,
      })
      expect(result).toEqual({ temperature: 0.4, topP: 0.95 })
    })

    it('omits temperature when undefined (reasoning models)', async () => {
      const { buildSamplingOptions } = await import('./shared')
      const result = buildSamplingOptions({})
      expect(result).toEqual({})
      expect('temperature' in result).toBe(false)
      expect('topP' in result).toBe(false)
    })
  })

  describe('resolveAgentProjectPath', () => {
    it('returns the path when set', async () => {
      const { resolveAgentProjectPath } = await import('./shared')
      expect(resolveAgentProjectPath('/my/project')).toBe('/my/project')
    })

    it('throws when path is null', async () => {
      const { resolveAgentProjectPath } = await import('./shared')
      expect(() => resolveAgentProjectPath(null)).toThrow(/No project path/)
    })

    it('throws when path is undefined', async () => {
      const { resolveAgentProjectPath } = await import('./shared')
      expect(() => resolveAgentProjectPath(undefined)).toThrow(/No project path/)
    })
  })

  describe('resolveProviderAndQuality', () => {
    const fakeProvider = {
      id: 'anthropic' as const,
      displayName: 'Anthropic',
      requiresApiKey: true,
      supportsBaseUrl: false,
      models: ['claude-sonnet-4-5'],
      testModel: 'claude-sonnet-4-5',
      createAdapter: () => ({}) as never,
    }

    it('returns error when no provider found', async () => {
      mockGetProviderForModel.mockReturnValue(undefined)
      const { resolveProviderAndQuality, isResolutionError } = await import('./shared')
      const result = resolveProviderAndQuality('unknown-model', 'medium', {})
      expect(isResolutionError(result)).toBe(true)
      if (!result.ok) {
        expect(result.reason).toContain('No provider registered')
      }
    })

    it('returns error when provider is disabled', async () => {
      mockGetProviderForModel.mockReturnValue(fakeProvider)
      mockIsKnownModel.mockReturnValue(true)
      const { resolveProviderAndQuality } = await import('./shared')
      const result = resolveProviderAndQuality('claude-sonnet-4-5', 'medium', {
        anthropic: { apiKey: 'key', enabled: false },
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('disabled')
      }
    })

    it('returns error when API key is missing', async () => {
      mockGetProviderForModel.mockReturnValue(fakeProvider)
      mockIsKnownModel.mockReturnValue(true)
      const { resolveProviderAndQuality } = await import('./shared')
      const result = resolveProviderAndQuality('claude-sonnet-4-5', 'medium', {
        anthropic: { apiKey: '', enabled: true },
      })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('No API key')
      }
    })

    it('returns resolved result on success', async () => {
      mockGetProviderForModel.mockReturnValue(fakeProvider)
      mockIsKnownModel.mockReturnValue(true)
      const { resolveProviderAndQuality } = await import('./shared')
      const result = resolveProviderAndQuality('claude-sonnet-4-5', 'medium', {
        anthropic: { apiKey: 'sk-test', enabled: true },
      })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.provider).toBe(fakeProvider)
        expect(result.providerConfig.apiKey).toBe('sk-test')
        expect(result.qualityConfig.temperature).toBeDefined()
      }
    })
  })
})
