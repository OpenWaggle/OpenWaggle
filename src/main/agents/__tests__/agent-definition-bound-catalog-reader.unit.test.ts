import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  agentDefinitionCatalogChildEnvironment,
  readBoundAgentDefinitionSources,
} from '../agent-definition-bound-catalog-reader'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('descriptor-bound Agent definition catalog reads', () => {
  it('runs an Electron executable in Node mode without inheriting arbitrary secrets', () => {
    const environment = agentDefinitionCatalogChildEnvironment()

    expect(environment.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(environment).not.toHaveProperty('OPENAI_API_KEY')
    expect(Object.keys(environment)).toEqual(
      expect.arrayContaining(['PATH', 'HOME', 'ELECTRON_RUN_AS_NODE']),
    )
  })

  it('fails closed when the authorized directory is replaced before the bound read', async () => {
    if (process.platform === 'win32') return
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-catalog-bound-'))
    roots.push(root)
    const project = path.join(root, 'project')
    const directory = path.join(project, '.agents', 'agents')
    const authorized = path.join(project, '.agents', 'agents-authorized')
    const outside = path.join(root, 'outside')
    await Promise.all([fs.mkdir(directory, { recursive: true }), fs.mkdir(outside)])
    await fs.writeFile(path.join(directory, 'safe.md'), 'safe')
    await fs.writeFile(path.join(outside, 'private.md'), 'private')

    await expect(
      readBoundAgentDefinitionSources({
        root: project,
        directory,
        beforeRead: async () => {
          await fs.rename(directory, authorized)
          await fs.symlink(outside, directory)
        },
      }),
    ).rejects.toThrow('catalog read failed')
  })
})
