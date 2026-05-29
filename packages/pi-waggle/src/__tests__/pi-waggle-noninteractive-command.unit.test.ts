import { beforeEach, describe, expect, it, vi } from 'vitest'

const { userHomeDir } = vi.hoisted(() => ({
  userHomeDir: '/tmp/pi-waggle-noninteractive-home',
}))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => userHomeDir,
}))

import { createHarness, resetPiWaggleCommandTestFiles } from './pi-waggle-command-harness'

describe('pi-waggle non-interactive command fallback', () => {
  beforeEach(resetPiWaggleCommandTestFiles)

  it('selects a valid preset deterministically for /waggle without UI', async () => {
    const harness = createHarness({ hasUI: false })

    await harness.waggleCommand.handler('', harness.ctx)

    expect(harness.ctx.ui.select).not.toHaveBeenCalled()
    expect(harness.appendedEntries).toEqual([
      {
        customType: 'pi-waggle.mode-state',
        data: expect.objectContaining({ enabled: true, presetId: 'code-review' }),
      },
    ])
  })
})
