import type { Provider, Settings } from '@shared/types/settings'
import { chat } from '@tanstack/ai'
import { createAnthropicChat } from '@tanstack/ai-anthropic'
import { createOpenaiChat } from '@tanstack/ai-openai'
import { ipcMain } from 'electron'
import { getSettings, updateSettings } from '../store/settings'

async function testAnthropicKey(apiKey: string): Promise<boolean> {
  try {
    const adapter = createAnthropicChat('claude-haiku-4-5', apiKey)
    const stream = chat({ adapter, messages: [{ role: 'user', content: 'Hi' }] })
    for await (const _ of stream) {
      break // first chunk confirms the key works
    }
    return true
  } catch {
    return false
  }
}

async function testOpenaiKey(apiKey: string): Promise<boolean> {
  try {
    const adapter = createOpenaiChat('gpt-4.1-nano', apiKey)
    const stream = chat({ adapter, messages: [{ role: 'user', content: 'Hi' }] })
    for await (const _ of stream) {
      break // first chunk confirms the key works
    }
    return true
  } catch {
    return false
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', () => {
    return getSettings()
  })

  ipcMain.handle('settings:update', (_event, partial: Partial<Settings>) => {
    updateSettings(partial)
  })

  ipcMain.handle('settings:test-api-key', async (_event, provider: Provider, apiKey: string) => {
    return provider === 'anthropic' ? testAnthropicKey(apiKey) : testOpenaiKey(apiKey)
  })
}
