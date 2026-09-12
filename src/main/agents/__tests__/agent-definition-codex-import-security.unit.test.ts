import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mapCodexAgent } from '../agent-definition-codex-import'
import {
  MAX_AGENT_DEFINITION_SOURCE_BYTES,
  readBoundedAgentDefinitionSource,
} from '../agent-definition-source-reader'

describe('Codex Agent definition nested source boundary', () => {
  let root = ''
  let selectedDirectory = ''
  let selectedPath = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-codex-import-'))
    selectedDirectory = path.join(root, 'selected')
    selectedPath = path.join(selectedDirectory, 'config.toml')
    await fs.mkdir(selectedDirectory)
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function config(configFile: string) {
    return `[agents.reviewer]\nconfig_file = ${JSON.stringify(configFile)}\n`
  }

  it('rejects traversal and absolute nested config paths', async () => {
    const outside = path.join(root, 'outside.toml')
    await fs.writeFile(outside, 'instructions = "private"', 'utf8')

    await expect(
      mapCodexAgent(
        { sourcePath: selectedPath, sourceName: 'reviewer' },
        config('../outside.toml'),
      ),
    ).rejects.toThrow('escapes its selected directory')
    await expect(
      mapCodexAgent({ sourcePath: selectedPath, sourceName: 'reviewer' }, config(outside)),
    ).rejects.toThrow('relative path')
  })

  it('rejects a nested symlink that resolves outside the selected directory', async () => {
    const outside = path.join(root, 'outside.toml')
    const nested = path.join(selectedDirectory, 'nested.toml')
    await fs.writeFile(outside, 'instructions = "private"', 'utf8')
    await fs.symlink(outside, nested)

    await expect(
      mapCodexAgent({ sourcePath: selectedPath, sourceName: 'reviewer' }, config('nested.toml')),
    ).rejects.toThrow('escapes its selected directory')
  })

  it('rejects oversized nested sources before parsing them', async () => {
    const nested = path.join(selectedDirectory, 'nested.toml')
    await fs.writeFile(nested, Buffer.alloc(MAX_AGENT_DEFINITION_SOURCE_BYTES + 1, 97))

    await expect(
      mapCodexAgent({ sourcePath: selectedPath, sourceName: 'reviewer' }, config('nested.toml')),
    ).rejects.toThrow('1 MiB')
  })

  it('keeps the authorized source descriptor pinned across a pathname swap', async () => {
    if (process.platform === 'win32') return
    const source = path.join(selectedDirectory, 'worker.md')
    const displaced = path.join(selectedDirectory, 'worker-authorized.md')
    const outside = path.join(root, 'outside.md')
    await fs.writeFile(source, 'safe instructions', 'utf8')
    await fs.writeFile(outside, 'private instructions', 'utf8')

    const result = await readBoundedAgentDefinitionSource({
      sourcePath: 'worker.md',
      containingDirectory: selectedDirectory,
      beforeRead: async () => {
        await fs.rename(source, displaced)
        await fs.symlink(outside, source)
      },
    })

    expect(result.content).toBe('safe instructions')
  })
})
