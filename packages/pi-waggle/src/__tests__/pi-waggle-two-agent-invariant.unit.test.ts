import { describe, expect, it } from 'vitest'
import { blankConfig } from '../default-config-editors'
import { createHarness } from './pi-waggle-command-harness'

function configWithThirdAgentJson() {
  const config = blankConfig()
  return JSON.stringify({
    ...config,
    agents: [...config.agents, { ...config.agents[0], label: 'Mediator' }],
  })
}

describe('pi-waggle two-agent invariant', () => {
  it('rejects a third agent entered through advanced active config JSON', async () => {
    const harness = createHarness({
      selectResponses: ['Advanced JSON…'],
      editorResponses: [configWithThirdAgentJson()],
    })

    await harness.waggleCommand.handler('config', harness.ctx)

    expect(harness.appendedEntries).toEqual([])
    expect(harness.ctx.ui.notify).toHaveBeenCalledWith(
      'agents must contain exactly 2 agent slots.',
      'error',
    )
  })
})
