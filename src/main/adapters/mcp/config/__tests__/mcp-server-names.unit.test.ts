import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listConfiguredMcpServerNames, mcpConfigFilePaths } from '../mcp-server-names'

let root: string
let homeDir: string
let projectPath: string

async function writeConfig(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, typeof value === 'string' ? value : JSON.stringify(value), 'utf-8')
}

describe('listConfiguredMcpServerNames', () => {
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'mcp-server-names-'))
    homeDir = path.join(root, 'home')
    projectPath = path.join(root, 'project')
    await mkdir(projectPath, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists the ADR 0051 files from lowest to highest priority', () => {
    expect(mcpConfigFilePaths({ homeDir, projectPath })).toEqual([
      path.join(homeDir, '.pi', 'agent', 'mcp.json'),
      path.join(homeDir, '.openwaggle', 'mcp.json'),
      path.join(projectPath, '.mcp.json'),
      path.join(projectPath, '.pi', 'mcp.json'),
      path.join(projectPath, '.openwaggle', 'mcp.json'),
    ])
  })

  it('returns no names and no errors when nothing is configured', async () => {
    await expect(listConfiguredMcpServerNames({ homeDir, projectPath })).resolves.toEqual({
      names: [],
      errors: [],
    })
  })

  it('collects the mcpServers keys of every file once, sorted', async () => {
    await writeConfig(path.join(homeDir, '.pi', 'agent', 'mcp.json'), {
      mcpServers: { github: { command: 'gh-mcp' } },
    })
    await writeConfig(path.join(homeDir, '.openwaggle', 'mcp.json'), {
      mcpServers: { linear: { url: 'https://mcp.linear.app/mcp' } },
    })
    await writeConfig(path.join(projectPath, '.mcp.json'), {
      mcpServers: { docs: { command: 'docs' }, github: { exposure: 'direct' } },
    })
    await writeConfig(path.join(projectPath, '.pi', 'mcp.json'), { mcpServers: {} })
    await writeConfig(path.join(projectPath, '.openwaggle', 'mcp.json'), {
      settings: { toolPrefix: 'server' },
      mcpServers: { figma: { url: 'https://figma.example/mcp' } },
    })

    await expect(listConfiguredMcpServerNames({ homeDir, projectPath })).resolves.toEqual({
      names: ['docs', 'figma', 'github', 'linear'],
      errors: [],
    })
  })

  it('ignores files without mcpServers and reports unreadable ones', async () => {
    await writeConfig(path.join(projectPath, '.mcp.json'), { servers: { vscode: {} } })
    await writeConfig(path.join(projectPath, '.pi', 'mcp.json'), '{ not json')
    await writeConfig(path.join(projectPath, '.openwaggle', 'mcp.json'), {
      mcpServers: ['not', 'an', 'object'],
    })
    await writeConfig(path.join(homeDir, '.openwaggle', 'mcp.json'), {
      mcpServers: { kept: { command: 'kept' } },
    })

    const result = await listConfiguredMcpServerNames({ homeDir, projectPath })

    expect(result.names).toEqual(['kept'])
    expect(result.errors).toEqual([
      expect.stringContaining(path.join(projectPath, '.pi', 'mcp.json')),
      expect.stringContaining('`mcpServers` must be an object'),
    ])
  })
})
