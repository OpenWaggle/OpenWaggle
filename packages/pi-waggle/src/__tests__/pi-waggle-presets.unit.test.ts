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

describe('Pi Waggle preset merging', () => {
  it('hides built-in presets by exact Pi preset ID', () => {
    const resolved = mergePiWagglePresetLayers({
      builtIns: [preset('code-review', 'Code Review')],
      userPresets: [],
      projectPresets: [],
      userHiddenBuiltInPresetIds: ['code-review'],
      projectHiddenBuiltInPresetIds: [],
    })

    expect(resolved).toEqual([])
  })

  it('keeps unrelated IDs distinct when merging layers', () => {
    const resolved = mergePiWagglePresetLayers({
      builtIns: [preset('code-review', 'Code Review')],
      userPresets: [preset('custom-code-review', 'Custom Override')],
      projectPresets: [],
      userHiddenBuiltInPresetIds: [],
      projectHiddenBuiltInPresetIds: [],
    })

    expect(resolved).toEqual([
      expect.objectContaining({
        scope: 'built-in',
        preset: expect.objectContaining({ id: 'code-review', name: 'Code Review' }),
      }),
      expect.objectContaining({
        scope: 'user',
        preset: expect.objectContaining({ id: 'custom-code-review', name: 'Custom Override' }),
      }),
    ])
  })
})
