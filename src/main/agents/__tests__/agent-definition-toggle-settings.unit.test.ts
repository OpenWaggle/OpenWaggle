import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { agentDefinitionTogglesForProject } from '../agent-definition-toggle-settings'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Agent definition project toggles', () => {
  it('uses the canonical project identity through a directory alias', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-toggle-'))
    roots.push(root)
    const realProject = path.join(root, 'real')
    const aliasProject = path.join(root, 'alias')
    await fs.mkdir(realProject)
    await fs.symlink(realProject, aliasProject, 'dir')
    const canonicalProject = await fs.realpath(realProject)

    await expect(
      agentDefinitionTogglesForProject({ [canonicalProject]: { reviewer: false } }, aliasProject),
    ).resolves.toEqual({ reviewer: false })
  })
})
