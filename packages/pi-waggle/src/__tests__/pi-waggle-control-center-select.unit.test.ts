import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, resetPiWaggleCommandTestFiles } from './pi-waggle-command-harness'

const CODE_REVIEW_LABEL = 'Code Review — built-in · 8 turns · openai/gpt-5.5'
const ENABLE_PRESET_LABEL = 'Enable preset'
const BACK_LABEL = 'Back'

describe('Waggle control center selector', () => {
  beforeEach(resetPiWaggleCommandTestFiles)

  it('steps back from preset actions to the control center', async () => {
    const harness = createHarness({
      selectResponses: [CODE_REVIEW_LABEL, BACK_LABEL, CODE_REVIEW_LABEL, ENABLE_PRESET_LABEL],
    })

    await harness.waggleCommand.handler('', harness.ctx)

    expect(harness.ctx.ui.select).toHaveBeenCalledWith(
      'Preset — Code Review',
      expect.arrayContaining([BACK_LABEL]),
    )
    expect(harness.appendedEntries).toEqual([
      {
        customType: 'pi-waggle.mode-state',
        data: expect.objectContaining({ enabled: true, presetId: 'code-review' }),
      },
    ])
  })

  it('uses Pi built-in selector even when custom UI is available', async () => {
    const harness = createHarness({
      customResponses: [undefined],
      selectResponses: [CODE_REVIEW_LABEL, ENABLE_PRESET_LABEL],
    })

    await harness.waggleCommand.handler('', harness.ctx)

    expect(harness.ctx.ui.custom).not.toHaveBeenCalled()
    expect(harness.ctx.ui.select).toHaveBeenCalledWith(
      'Waggle control center — off',
      expect.arrayContaining([CODE_REVIEW_LABEL]),
    )
  })
})
