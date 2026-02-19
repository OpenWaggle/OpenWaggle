import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, getAllMock, getMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  getAllMock: vi.fn(),
  getMock: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}))

vi.mock('../providers', () => ({
  providerRegistry: {
    getAll: getAllMock,
    get: getMock,
  },
}))

import { registerProvidersHandlers } from './providers-handler'

function registeredHandler(name: string): ((...args: unknown[]) => unknown) | undefined {
  const call = handleMock.mock.calls.find(([channel]) => channel === name)
  return call?.[1] as ((...args: unknown[]) => unknown) | undefined
}

describe('registerProvidersHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    getAllMock.mockReset()
    getMock.mockReset()
  })

  it('registers providers:get-models and returns mapped display info', () => {
    getAllMock.mockReturnValue([
      {
        id: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        apiKeyManagementUrl: 'https://platform.openai.com/api-keys',
        supportsBaseUrl: false,
        models: ['gpt-4.1-mini'],
      },
    ])

    registerProvidersHandlers()
    const handler = registeredHandler('providers:get-models')

    expect(handler).toBeDefined()
    const result = handler?.()
    expect(result).toEqual([
      {
        provider: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        apiKeyManagementUrl: 'https://platform.openai.com/api-keys',
        supportsBaseUrl: false,
        models: [{ id: 'gpt-4.1-mini', name: 'GPT 4.1 Mini', provider: 'openai' }],
      },
    ])
  })

  it('registers providers:fetch-models and returns empty array when provider has no fetchModels', async () => {
    getMock.mockReturnValue({
      id: 'anthropic',
      models: ['claude-sonnet-4-5'],
    })

    registerProvidersHandlers()
    const handler = registeredHandler('providers:fetch-models')

    expect(handler).toBeDefined()
    const result = await handler?.({}, 'anthropic')
    expect(result).toEqual([])
  })

  it('maps fetched models to display entries', async () => {
    getMock.mockReturnValue({
      id: 'ollama',
      models: ['llama3.1'],
      fetchModels: vi.fn(async () => ['llama3.1', 'qwen2.5-coder']),
    })

    registerProvidersHandlers()
    const handler = registeredHandler('providers:fetch-models')

    const result = await handler?.({}, 'ollama', 'http://localhost:11434', 'unused')
    expect(result).toEqual([
      { id: 'llama3.1', name: 'Llama3.1', provider: 'ollama' },
      { id: 'qwen2.5-coder', name: 'Qwen2.5 Coder', provider: 'ollama' },
    ])
  })
})
