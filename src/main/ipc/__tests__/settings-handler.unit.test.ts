import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getSettingsMock,
  getTypedEffectInvokeHandler,
  loadSettingsHandlers,
  reconcileTrustedMainExtensionsMock,
  resetSettingsHandlerMocks,
  typedHandleMock,
  updateSettingsMock,
} from './settings-handler.test-harness'

describe('registerSettingsHandlers', () => {
  let registerSettingsHandlers: Awaited<
    ReturnType<typeof loadSettingsHandlers>
  >['registerSettingsHandlers']
  let tempProjectPaths: string[] = []

  beforeEach(async () => {
    resetSettingsHandlerMocks()
    ;({ registerSettingsHandlers } = await loadSettingsHandlers())
  })

  afterEach(async () => {
    const paths = tempProjectPaths
    tempProjectPaths = []
    await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })))
  })

  it('registers all expected IPC channels', () => {
    registerSettingsHandlers()

    const typedEffectChannels = typedHandleMock.mock.calls
      .map((call) => (typeof call[0] === 'string' ? call[0] : ''))
      .filter(Boolean)

    expect(typedEffectChannels).toContain('settings:get')
    expect(typedEffectChannels).toContain('settings:update')
    expect(typedEffectChannels).toContain('pi-settings:get-tree-filter-mode')
    expect(typedEffectChannels).toContain('pi-settings:set-tree-filter-mode')
    expect(typedEffectChannels).toContain('pi-settings:get-branch-summary-skip-prompt')
    expect(typedEffectChannels).toContain('settings:test-api-key')
  })

  describe('settings:get', () => {
    it('returns the current settings', async () => {
      getSettingsMock.mockReturnValue(DEFAULT_SETTINGS)
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:get')
      expect(handler).toBeDefined()

      const result = await handler?.()
      expect(result).toEqual(DEFAULT_SETTINGS)
      expect(getSettingsMock).toHaveBeenCalledOnce()
    })
  })

  describe('settings:update', () => {
    it('validates and applies a valid settings update', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const result = await handler?.({}, { thinkingLevel: 'high' })
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingLevel: 'high' }),
      )
    })

    it('rejects an invalid settings payload and returns error', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const result = await handler?.({}, { thinkingLevel: 'invalid-mode' })
      expect(result).toEqual({ ok: false, error: expect.any(String) })
      expect(updateSettingsMock).not.toHaveBeenCalled()
    })

    it('validates browser defaults before they reach persistence', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      const valid = await handler?.(
        {},
        {
          browserDefaultViewport: {
            mode: 'fixed',
            width: 390,
            height: 844,
            presetId: 'iphone-12-pro',
          },
          browserDefaultZoomFactor: 1.25,
          browserDefaultAppearance: 'dark',
          browserRecordingFrameRate: 60,
          browserAutoShowFloatingPreview: false,
        },
      )

      expect(valid).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          browserDefaultZoomFactor: 1.25,
          browserRecordingFrameRate: 60,
          browserAutoShowFloatingPreview: false,
        }),
      )

      updateSettingsMock.mockClear()
      const invalid = await handler?.({}, { browserRecordingFrameRate: 120 })
      expect(invalid).toEqual({ ok: false, error: expect.any(String) })
      expect(updateSettingsMock).not.toHaveBeenCalled()
    })

    it('accepts only percentage-range automatic compaction thresholds', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      await expect(handler?.({}, { compactionThresholdPercent: 0 })).resolves.toEqual({
        ok: false,
        error: expect.any(String),
      })
      await expect(handler?.({}, { compactionThresholdPercent: 73 })).resolves.toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ compactionThresholdPercent: 73 }),
      )
    })

    it('converts selectedModel canonical ref to SupportedModelId', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      await handler?.({}, { selectedModel: 'openai/gpt-4.1-mini' })

      expect(updateSettingsMock).toHaveBeenCalledOnce()
      const call = updateSettingsMock.mock.calls[0][0]
      expect(call.selectedModel).toBe('openai/gpt-4.1-mini')
    })

    it('passes empty selectedModel through so the settings store can clear stale selections', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      await handler?.({}, { selectedModel: '' })

      expect(updateSettingsMock).toHaveBeenCalledOnce()
      const call = updateSettingsMock.mock.calls[0][0]
      expect(call.selectedModel).toBe('')
    })

    it('converts favoriteModels canonical refs to SupportedModelId array', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      await handler?.(
        {},
        {
          favoriteModels: ['anthropic/claude-sonnet-4-5', 'openai/gpt-4.1-mini'],
        },
      )

      expect(updateSettingsMock).toHaveBeenCalledOnce()
      const call = updateSettingsMock.mock.calls[0][0]
      expect(call.favoriteModels).toEqual(['anthropic/claude-sonnet-4-5', 'openai/gpt-4.1-mini'])
    })

    it('accepts projectPath as null', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const result = await handler?.({}, { projectPath: null })
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: null }),
      )
      expect(reconcileTrustedMainExtensionsMock).toHaveBeenCalledWith(null)
    })

    it('reconciles trusted main extensions after projectPath updates', async () => {
      const projectPath = await mkdtemp(join(tmpdir(), 'openwaggle-settings-project-'))
      const canonicalProjectPath = await realpath(projectPath)
      tempProjectPaths.push(canonicalProjectPath)
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const result = await handler?.({}, { projectPath })

      expect(result).toEqual({ ok: true })
      expect(reconcileTrustedMainExtensionsMock).toHaveBeenCalledWith(canonicalProjectPath)
    })

    it('does not reconcile trusted main extensions for unrelated settings updates', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const result = await handler?.({}, { thinkingLevel: 'high' })

      expect(result).toEqual({ ok: true })
      expect(reconcileTrustedMainExtensionsMock).not.toHaveBeenCalled()
    })

    it('accepts skillTogglesByProject update', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const result = await handler?.(
        {},
        {
          skillTogglesByProject: {
            '/tmp/repo': { 'skill-a': true, 'skill-b': false },
          },
        },
      )
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
    })
  })
})
