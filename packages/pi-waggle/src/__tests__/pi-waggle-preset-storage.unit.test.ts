import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readPiWagglePresetsFileData } from '../preset-storage'
import { customPreset } from './pi-waggle-command-harness'

describe('pi-waggle preset storage', () => {
  it('skips manually edited presets with more than two agents', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pi-waggle-presets-'))
    try {
      const validPreset = customPreset('valid-preset', 'Valid Preset')
      const invalidPreset = {
        ...customPreset('invalid-preset', 'Invalid Preset'),
        config: {
          ...validPreset.config,
          agents: [
            ...validPreset.config.agents,
            { ...validPreset.config.agents[0], label: 'Mediator' },
          ],
        },
      }
      const filePath = join(tempDir, 'waggle-presets.json')
      await writeFile(
        filePath,
        `${JSON.stringify({ wagglePresets: [validPreset, invalidPreset] })}\n`,
        'utf-8',
      )

      const data = await readPiWagglePresetsFileData(filePath)

      expect(data.wagglePresets.map((preset) => preset.id)).toEqual(['valid-preset'])
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
