import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { duplicateWorkspaceEntry, moveWorkspaceEntry } from '../workspace-entry-mutations'

describe('workspace entry mutations', () => {
  let temporaryRoot = ''
  let projectPath = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-entry-mutations-'))
    projectPath = path.join(temporaryRoot, 'project')
    await fs.mkdir(path.join(projectPath, 'src'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'src', 'alpha.ts'), 'export const alpha = 1\n')
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it.each([
    ['move', moveWorkspaceEntry],
    ['duplicate', duplicateWorkspaceEntry],
  ] as const)(
    'rejects an overwrite %s whose destination contains the source',
    async (_, mutate) => {
      await expect(
        mutate({
          projectPath,
          path: 'src/alpha.ts',
          targetPath: 'src',
          overwrite: true,
        }),
      ).rejects.toThrow('The destination cannot contain the source entry.')

      if (process.platform === 'linux') {
        await fs.symlink('src', path.join(projectPath, 'SRC'), 'dir')
      }
      await expect(
        mutate({
          projectPath,
          path: 'src/alpha.ts',
          targetPath: 'SRC',
          overwrite: true,
        }),
      ).rejects.toThrow('The destination cannot contain the source entry.')

      await expect(fs.readFile(path.join(projectPath, 'src', 'alpha.ts'), 'utf8')).resolves.toBe(
        'export const alpha = 1\n',
      )
    },
  )
})
