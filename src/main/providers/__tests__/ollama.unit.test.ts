import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/ai-ollama', () => ({
  OllamaTextModels: ['llama3.2', 'codellama'] as const,
  createOllamaChat: vi.fn(() => ({ type: 'ollama-adapter' })),
}))

describe('ollamaProvider', () => {
  it('creates adapter with default base URL when none provided', async () => {
    const { ollamaProvider } = await import('../ollama')
    const { createOllamaChat } = await import('@tanstack/ai-ollama')
    ollamaProvider.createAdapter('llama3.2', undefined)
    expect(createOllamaChat).toHaveBeenCalledWith('llama3.2', 'http://localhost:11434')
  })

  it('creates adapter with custom base URL', async () => {
    const { ollamaProvider } = await import('../ollama')
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
      const { ollamaProvider } = await import('../ollama')
      const fetchModels = ollamaProvider.fetchModels
      expect(fetchModels).toBeDefined()
      if (!fetchModels) return

      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ models: [{ name: 'llama3.2' }, { name: 'mistral' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const models = await fetchModels()
      expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/tags')
      expect(models).toEqual(['llama3.2', 'mistral'])
    })

    it('returns empty array on HTTP error', async () => {
      const { ollamaProvider } = await import('../ollama')
      const fetchModels = ollamaProvider.fetchModels
      if (!fetchModels) return
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }))
      const models = await fetchModels()
      expect(models).toEqual([])
    })

    it('returns empty array on network error', async () => {
      const { ollamaProvider } = await import('../ollama')
      const fetchModels = ollamaProvider.fetchModels
      if (!fetchModels) return
      vi.mocked(fetch).mockRejectedValue(new Error('network error'))
      const models = await fetchModels()
      expect(models).toEqual([])
    })

    it('returns empty array on invalid response schema', async () => {
      const { ollamaProvider } = await import('../ollama')
      const fetchModels = ollamaProvider.fetchModels
      if (!fetchModels) return

      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      const models = await fetchModels()
      expect(models).toEqual([])
    })

    it('uses custom base URL for fetch', async () => {
      const { ollamaProvider } = await import('../ollama')
      const fetchModels = ollamaProvider.fetchModels
      if (!fetchModels) return
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }))
      await fetchModels('http://custom:9999')
      expect(fetch).toHaveBeenCalledWith('http://custom:9999/api/tags')
    })
  })
})
