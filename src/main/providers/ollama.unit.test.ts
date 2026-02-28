import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/ai-ollama', () => ({
  OllamaTextModels: ['llama3.2', 'codellama'] as const,
  createOllamaChat: vi.fn(() => ({ type: 'ollama-adapter' })),
}))

vi.mock('@shared/schemas/validation', () => ({
  ollamaTagsResponseSchema: {
    safeParse: vi.fn(),
  },
}))

describe('ollamaProvider', () => {
  it('exports correct provider metadata', async () => {
    const { ollamaProvider } = await import('./ollama')
    expect(ollamaProvider.id).toBe('ollama')
    expect(ollamaProvider.displayName).toBe('Ollama')
    expect(ollamaProvider.requiresApiKey).toBe(false)
    expect(ollamaProvider.supportsBaseUrl).toBe(true)
    expect(ollamaProvider.supportsSubscription).toBe(false)
    expect(ollamaProvider.supportsDynamicModelFetch).toBe(true)
  })

  it('creates adapter with default base URL when none provided', async () => {
    const { ollamaProvider } = await import('./ollama')
    const { createOllamaChat } = await import('@tanstack/ai-ollama')
    ollamaProvider.createAdapter('llama3.2', undefined)
    expect(createOllamaChat).toHaveBeenCalledWith('llama3.2', 'http://localhost:11434')
  })

  it('creates adapter with custom base URL', async () => {
    const { ollamaProvider } = await import('./ollama')
    const { createOllamaChat } = await import('@tanstack/ai-ollama')
    ollamaProvider.createAdapter('llama3.2', undefined, 'http://custom:8080')
    expect(createOllamaChat).toHaveBeenCalledWith('llama3.2', 'http://custom:8080')
  })

  describe('fetchModels', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn())
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('returns model names from Ollama API tags endpoint', async () => {
      const { ollamaProvider } = await import('./ollama')
      const { ollamaTagsResponseSchema } = await import('@shared/schemas/validation')
      const fetchModels = ollamaProvider.fetchModels
      expect(fetchModels).toBeDefined()
      if (!fetchModels) return

      const mockResponse = { ok: true, json: () => Promise.resolve({}) }
      vi.mocked(fetch).mockResolvedValue(mockResponse as Response)
      vi.mocked(ollamaTagsResponseSchema.safeParse).mockReturnValue({
        success: true,
        data: { models: [{ name: 'llama3.2' }, { name: 'mistral' }] },
      } as never)

      const models = await fetchModels()
      expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/tags')
      expect(models).toEqual(['llama3.2', 'mistral'])
    })

    it('returns empty array on HTTP error', async () => {
      const { ollamaProvider } = await import('./ollama')
      const fetchModels = ollamaProvider.fetchModels
      if (!fetchModels) return
      vi.mocked(fetch).mockResolvedValue({ ok: false } as Response)
      const models = await fetchModels()
      expect(models).toEqual([])
    })

    it('returns empty array on network error', async () => {
      const { ollamaProvider } = await import('./ollama')
      const fetchModels = ollamaProvider.fetchModels
      if (!fetchModels) return
      vi.mocked(fetch).mockRejectedValue(new Error('network error'))
      const models = await fetchModels()
      expect(models).toEqual([])
    })

    it('returns empty array on invalid response schema', async () => {
      const { ollamaProvider } = await import('./ollama')
      const { ollamaTagsResponseSchema } = await import('@shared/schemas/validation')
      const fetchModels = ollamaProvider.fetchModels
      if (!fetchModels) return

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response)
      vi.mocked(ollamaTagsResponseSchema.safeParse).mockReturnValue({
        success: false,
        error: new Error('invalid'),
      } as never)

      const models = await fetchModels()
      expect(models).toEqual([])
    })

    it('uses custom base URL for fetch', async () => {
      const { ollamaProvider } = await import('./ollama')
      const fetchModels = ollamaProvider.fetchModels
      if (!fetchModels) return
      vi.mocked(fetch).mockResolvedValue({ ok: false } as Response)
      await fetchModels('http://custom:9999')
      expect(fetch).toHaveBeenCalledWith('http://custom:9999/api/tags')
    })
  })
})
