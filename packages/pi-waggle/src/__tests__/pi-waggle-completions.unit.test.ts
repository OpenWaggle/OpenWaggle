import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { userHomeDir } = vi.hoisted(() => ({
  userHomeDir: '/tmp/pi-waggle-completions-home',
}))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => userHomeDir,
}))

import { defaultWaggleCommandCompletions } from '../default-commands'
import {
  getPiWaggleProjectPresetsPath,
  getPiWaggleUserPresetsPath,
  writePiWagglePresetsFile,
} from '../preset-storage'
import {
  customPreset,
  projectDir,
  resetPiWaggleCommandTestFiles,
} from './pi-waggle-command-harness'

describe('pi-waggle command completions', () => {
  beforeEach(resetPiWaggleCommandTestFiles)

  it('completes user presets without command context', async () => {
    await writePiWagglePresetsFile(getPiWaggleUserPresetsPath(), [
      customPreset('custom-user', 'User Only'),
    ])
    await writePiWagglePresetsFile(getPiWaggleProjectPresetsPath(projectDir), [
      customPreset('custom-project', 'Project Only'),
    ])

    const completions = await defaultWaggleCommandCompletions('custom')

    expect(completions).toEqual([
      expect.objectContaining({
        value: 'custom-user',
        label: 'User Only',
        description: 'User Only description',
      }),
    ])
  })

  it('completes project presets when command context includes cwd', async () => {
    await writePiWagglePresetsFile(getPiWaggleUserPresetsPath(), [
      customPreset('custom-user', 'User Only'),
    ])
    await writePiWagglePresetsFile(getPiWaggleProjectPresetsPath(projectDir), [
      customPreset('custom-project', 'Project Only'),
    ])

    const completions = await defaultWaggleCommandCompletions(
      'custom',
      fromPartial<ExtensionCommandContext>({ cwd: projectDir }),
    )

    expect(completions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'custom-user',
          label: 'User Only',
          description: 'User Only description',
        }),
        expect.objectContaining({
          value: 'custom-project',
          label: 'Project Only',
          description: 'Project Only description',
        }),
      ]),
    )
  })
})
