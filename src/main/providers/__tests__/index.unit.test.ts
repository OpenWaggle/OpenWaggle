import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRegister = vi.fn()
const PROVIDER_REGISTRATION_TEST_TIMEOUT_MS = 15_000

const mockGetAll = vi.fn<() => unknown[]>().mockReturnValue([])
const mockIndexModels = vi.fn()

vi.mock('../registry', () => ({
  providerRegistry: {
    register: (...args: unknown[]) => mockRegister(...args),
    getAll: () => mockGetAll(),
    indexModels: (...args: unknown[]) => mockIndexModels(...args),
  },
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('registerAllProviders', () => {
  beforeEach(() => {
    mockRegister.mockClear()
  })

  it(
    'registers all 6 providers',
    async () => {
      const { registerAllProviders } = await import('../index')
      await registerAllProviders()
      expect(mockRegister).toHaveBeenCalledTimes(6)

      const registeredIds = mockRegister.mock.calls.map(
        (call: unknown[]) => (call[0] as { id: string }).id,
      )
      expect(registeredIds).toContain('anthropic')
      expect(registeredIds).toContain('openai')
      expect(registeredIds).toContain('gemini')
      expect(registeredIds).toContain('grok')
      expect(registeredIds).toContain('openrouter')
      expect(registeredIds).toContain('ollama')
    },
    PROVIDER_REGISTRATION_TEST_TIMEOUT_MS,
  )
})
