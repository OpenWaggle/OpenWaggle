import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock, warn } = vi.hoisted(() => ({
  apiMock: {
    getProjectPreferences: vi.fn(),
    updateSettings: vi.fn(),
  },
  warn: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))
vi.mock('@/shared/lib/logger', () => ({
  createRendererLogger: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { usePreferencesStore } from '../preferences-store'

/*
 * A project whose preferences cannot be read, as one whose `.openwaggle` is a link to nothing,
 * keeps the settings it had: the project still opens, and the failure is logged, not thrown.
 */
describe("A project's preferences that cannot be read", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, selectedModel: SupportedModelId('openai/gpt-5.5') },
    })
    apiMock.getProjectPreferences.mockRejectedValue(
      new Error(
        "Error invoking remote method 'project-config:get-preferences': Error: ENOENT: no such file or directory, stat '/repo/.openwaggle'",
      ),
    )
  })

  it('keeps the model it had and logs why', async () => {
    await expect(
      usePreferencesStore.getState().loadProjectPreferences('/repo'),
    ).resolves.toBeUndefined()

    expect(usePreferencesStore.getState().settings.selectedModel).toBe('openai/gpt-5.5')
    expect(apiMock.updateSettings).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      'Could not read the project preferences; keeping the current settings',
      expect.objectContaining({ projectPath: '/repo' }),
    )
  })
})
