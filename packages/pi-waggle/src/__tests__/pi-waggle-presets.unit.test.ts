import { WAGGLE_INHERIT_MODEL, type WagglePreset } from '@openwaggle/waggle-core'
import { describe, expect, it } from 'vitest'
import { mergePiWagglePresetLayers } from '../presets'

function preset(id: string, name: string): WagglePreset {
  return {
    id,
    name,
    description: `${name} preset`,
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Architect',
          model: WAGGLE_INHERIT_MODEL,
          roleDescription: 'Plans',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: WAGGLE_INHERIT_MODEL,
          roleDescription: 'Reviews',
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 4 },
    },
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('Pi Waggle preset compatibility', () => {
  it('applies legacy built-in hidden IDs to current built-in IDs', () => {
    const resolved = mergePiWagglePresetLayers({
      builtIns: [preset('code-review', 'Code Review')],
      userPresets: [],
      projectPresets: [],
      userHiddenBuiltInPresetIds: ['builtin-code-review'],
      projectHiddenBuiltInPresetIds: [],
    })

    expect(resolved).toEqual([])
  })

  it('normalizes legacy override IDs before merging layers', () => {
    const resolved = mergePiWagglePresetLayers({
      builtIns: [preset('code-review', 'Code Review')],
      userPresets: [preset('builtin-code-review', 'Legacy Override')],
      projectPresets: [],
      userHiddenBuiltInPresetIds: [],
      projectHiddenBuiltInPresetIds: [],
    })

    expect(resolved).toEqual([
      expect.objectContaining({
        scope: 'user',
        preset: expect.objectContaining({ id: 'code-review', name: 'Legacy Override' }),
      }),
    ])
  })
})
