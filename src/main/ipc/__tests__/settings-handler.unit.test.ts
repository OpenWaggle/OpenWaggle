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
  updateSettingsMock,
} from './settings-handler.test-harness'

function getRegisteredSettingsUpdateHandler(registerSettingsHandlers: () => void) {
  registerSettingsHandlers()
  const handler = getTypedEffectInvokeHandler('settings:update')
  expect(handler).toBeDefined()
  return handler
}

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

  describe('settings:set-enabled-models', () => {
    it('persists string model refs and preserves invalid-payload behavior', async () => {
      registerSettingsHandlers()
      const handler = getTypedEffectInvokeHandler('settings:set-enabled-models')

      await expect(handler?.({}, ['openai/gpt-5.4'])).resolves.toBeUndefined()
      expect(updateSettingsMock).toHaveBeenCalledWith({ enabledModels: ['openai/gpt-5.4'] })

      updateSettingsMock.mockClear()
      await expect(handler?.({}, ['openai/gpt-5.4', 42])).resolves.toBeUndefined()
      expect(updateSettingsMock).not.toHaveBeenCalled()
    })
  })

  describe('settings:update', () => {
    it.each([
      ['an update channel', { updateChannel: 'beta' }],
      [
        'every Session Host policy setting',
        {
          sessionHostParentConcurrencyLimit: 8,
          sessionHostParentConcurrencyLimitsByProject: { '/project': 12 },
          sessionHostRunCeiling: 24,
          sessionHostIdleGracePeriodMs: 0,
          multiAgentEnabled: false,
          multiAgentEnabledByProject: { '/project': true },
        },
      ],
      ['a canonical selected model', { selectedModel: 'openai/gpt-4.1-mini' }],
      ['an empty selected model, so the store can clear a stale one', { selectedModel: '' }],
      [
        'canonical favorite models',
        { favoriteModels: ['anthropic/claude-sonnet-4-5', 'openai/gpt-4.1-mini'] },
      ],
      [
        'per-project skill toggles',
        { skillTogglesByProject: { '/tmp/repo': { 'skill-a': true, 'skill-b': false } } },
      ],
    ])('validates and forwards %s to the settings store', async (_label, patch) => {
      const handler = getRegisteredSettingsUpdateHandler(registerSettingsHandlers)

      await expect(handler?.({}, patch)).resolves.toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
      expect(updateSettingsMock).toHaveBeenCalledWith(expect.objectContaining(patch))
    })

    it('rejects invalid payloads, Session Host policy settings included, before persistence', async () => {
      const handler = getRegisteredSettingsUpdateHandler(registerSettingsHandlers)
      for (const patch of [
        { updateChannel: 'invalid-mode' },
        { sessionHostParentConcurrencyLimit: 0 },
        { sessionHostParentConcurrencyLimitsByProject: { '/project': -1 } },
        { sessionHostRunCeiling: 1.5 },
        { sessionHostIdleGracePeriodMs: -1 },
        { multiAgentEnabled: 'yes' },
        { multiAgentEnabledByProject: { '/project': 'yes' } },
      ]) {
        await expect(handler?.({}, patch)).resolves.toEqual({
          ok: false,
          error: expect.any(String),
        })
      }
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

    it('accepts projectPath as null', async () => {
      const handler = getRegisteredSettingsUpdateHandler(registerSettingsHandlers)

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
      const handler = getRegisteredSettingsUpdateHandler(registerSettingsHandlers)

      const result = await handler?.({}, { projectPath })

      expect(result).toEqual({ ok: true })
      expect(reconcileTrustedMainExtensionsMock).toHaveBeenCalledWith(canonicalProjectPath)
    })

    it('does not reconcile trusted main extensions for unrelated settings updates', async () => {
      const handler = getRegisteredSettingsUpdateHandler(registerSettingsHandlers)

      const result = await handler?.({}, { updateChannel: 'beta' })

      expect(result).toEqual({ ok: true })
      expect(reconcileTrustedMainExtensionsMock).not.toHaveBeenCalled()
    })
  })
})
