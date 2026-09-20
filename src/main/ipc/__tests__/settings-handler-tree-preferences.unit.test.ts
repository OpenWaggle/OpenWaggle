import { beforeEach, describe, expect, it } from 'vitest'
import {
  getBranchSummarySkipPromptMock,
  getTreeFilterModeMock,
  getTypedEffectInvokeHandler,
  loadSettingsHandlers,
  resetSettingsHandlerMocks,
  setTreeFilterModeMock,
} from './settings-handler.test-harness'

describe('Pi tree preference handlers', () => {
  let registerSettingsHandlers: Awaited<
    ReturnType<typeof loadSettingsHandlers>
  >['registerSettingsHandlers']
  beforeEach(async () => {
    resetSettingsHandlerMocks()
    ;({ registerSettingsHandlers } = await loadSettingsHandlers())
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
