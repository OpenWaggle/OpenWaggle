import { describe, expect, it } from 'vitest'
import { blankConfig } from '../default-config-editors'

describe('pi-waggle config defaults', () => {
  it('uses generic labels for new custom preset agents until users rename them', () => {
    const config = blankConfig()

    expect(config.agents).toMatchObject([{ label: 'Agent 1' }, { label: 'Agent 2' }])
  })
})
