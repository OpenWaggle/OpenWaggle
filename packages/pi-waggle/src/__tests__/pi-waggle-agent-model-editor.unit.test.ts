import { WAGGLE_INHERIT_MODEL } from '@openwaggle/waggle-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { userHomeDir } = vi.hoisted(() => ({
  userHomeDir: '/tmp/pi-waggle-agent-model-editor-home',
}))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => userHomeDir,
}))

import {
  activeModeStateEntry,
  createHarness,
  resetPiWaggleCommandTestFiles,
} from './pi-waggle-command-harness'

const PINNED_MODEL = 'anthropic/claude-sonnet-4'

function inheritedConfigJson() {
  return JSON.stringify({
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: WAGGLE_INHERIT_MODEL,
        roleDescription: 'Plans the implementation',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: WAGGLE_INHERIT_MODEL,
        roleDescription: 'Reviews the implementation',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 4 },
  })
}

describe('pi-waggle agent model editor', () => {
  beforeEach(resetPiWaggleCommandTestFiles)

  it('pins only the selected agent slot without changing the standard Pi model', async () => {
    const harness = createHarness({
      branchEntries: [activeModeStateEntry(inheritedConfigJson())],
      selectResponses: [
        'Edit Architect — openai/gpt-5.5 · Plans the implementation',
        'Change model — openai/gpt-5.5',
        'Pin concrete model…',
        'Back',
        'Done',
      ],
      inputResponses: [PINNED_MODEL],
    })

    await harness.waggleCommand.handler('config', harness.ctx)

    expect(harness.setModelCallCount()).toBe(0)
    expect(harness.appendedEntries).toEqual([
      {
        customType: 'pi-waggle.mode-state',
        data: expect.objectContaining({
          enabled: true,
          config: expect.objectContaining({
            agents: [
              expect.objectContaining({ model: PINNED_MODEL }),
              expect.objectContaining({ model: WAGGLE_INHERIT_MODEL }),
            ],
          }),
        }),
      },
    ])
  })
})
