import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getBranchSummarySkipPromptMock,
  getSettingsMock,
  getTreeFilterModeMock,
  getTypedEffectInvokeHandler,
  loadSettingsHandlers,
  reconcileTrustedMainExtensionsMock,
  resetSettingsHandlerMocks,
  setTreeFilterModeMock,
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

  describe('pi tree preferences', () => {
    it('returns the persisted Pi tree filter mode', async () => {
      getTreeFilterModeMock.mockReturnValue('no-tools')
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('pi-settings:get-tree-filter-mode')
      expect(handler).toBeDefined()

      const result = await handler?.({}, null)
      expect(result).toBe('no-tools')
      expect(getTreeFilterModeMock).toHaveBeenCalledWith(undefined)
    })

    it('validates and persists a Pi tree filter mode', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('pi-settings:set-tree-filter-mode')
      expect(handler).toBeDefined()

      const result = await handler?.({}, 'labeled-only', null)
      expect(result).toBeUndefined()
      expect(setTreeFilterModeMock).toHaveBeenCalledWith('labeled-only', undefined)
    })

    it('rejects invalid Pi tree filter modes', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('pi-settings:set-tree-filter-mode')
      expect(handler).toBeDefined()

      await expect(handler?.({}, 'bad-mode', null)).rejects.toThrow('Invalid tree filter mode')
      expect(setTreeFilterModeMock).not.toHaveBeenCalled()
    })

    it('returns the Pi branch-summary skip-prompt preference', async () => {
      getBranchSummarySkipPromptMock.mockReturnValue(true)
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('pi-settings:get-branch-summary-skip-prompt')
      expect(handler).toBeDefined()

      const result = await handler?.({}, null)
      expect(result).toBe(true)
      expect(getBranchSummarySkipPromptMock).toHaveBeenCalledWith(undefined)
    })
  })
})
