import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { previewMcpImports } from '../import-adapters'

const fixtureRoots: string[] = []

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-imports-'))
  fixtureRoots.push(root)
  return { root, projectPath: path.join(root, 'project'), appDataDir: path.join(root, 'AppData') }
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('MCP import paths', () => {
  it('uses Windows application-data paths for Claude Desktop and VS Code', async () => {
    const { root, appDataDir } = await createFixture()
    const claudePath = path.join(appDataDir, 'Claude', 'claude_desktop_config.json')
    const vscodePath = path.join(appDataDir, 'Code', 'User', 'mcp.json')
    await writeJson(claudePath, { mcpServers: { claude: { command: 'claude-mcp' } } })
    await writeJson(vscodePath, { servers: { code: { command: 'code-mcp' } } })

    const preview = await previewMcpImports({
      homeDir: root,
      appDataDir,
      platform: 'win32',
      sources: ['claude-desktop', 'vscode'],
    })

    expect(preview.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'claude-desktop',
          sourcePath: claudePath,
          name: 'claude',
        }),
        expect.objectContaining({ source: 'vscode', sourcePath: vscodePath, name: 'code' }),
      ]),
    )
  })

  it('finds every legacy OpenWaggle Pi MCP source and recovers disabled servers', async () => {
    const { root, projectPath } = await createFixture()
    await writeJson(path.join(root, '.config', 'mcp', 'mcp.json'), {
      'mcp-servers': { globalStandard: { command: 'global-standard-mcp' } },
    })
    await writeJson(path.join(root, '.pi', 'agent', 'mcp.json'), {
      mcpServers: { globalPi: { command: 'global-pi-mcp' } },
    })
    await writeJson(path.join(projectPath, '.agents', 'mcp.json'), {
      mcpServers: { agents: { command: 'agents-mcp' } },
    })
    await writeJson(path.join(projectPath, '.pi', 'mcp.json'), {
      mcpServers: { projectPi: { command: 'project-pi-mcp' } },
    })
    await writeJson(path.join(projectPath, '.openwaggle', 'agent', 'mcp.json'), {
      mcpServers: { openwaggle: { command: 'openwaggle-mcp' } },
    })
    await writeJson(path.join(projectPath, '.mcp.json'), {
      mcpServers: { alreadyNative: { command: 'native-mcp' } },
      openwaggle: { disabledMcpServers: { disabled: { command: 'disabled-mcp' } } },
    })

    const preview = await previewMcpImports({ homeDir: root, projectPath, sources: ['pi'] })

    expect(preview.candidates.map((candidate) => candidate.name)).toEqual([
      'agents',
      'disabled',
      'globalPi',
      'globalStandard',
      'openwaggle',
      'projectPi',
    ])
    expect(
      preview.candidates.find((candidate) => candidate.name === 'alreadyNative'),
    ).toBeUndefined()
    expect(preview.candidates.find((candidate) => candidate.name === 'globalPi')).toMatchObject({
      suggestedTarget: 'global',
    })
    expect(preview.candidates.find((candidate) => candidate.name === 'disabled')).toMatchObject({
      suggestedTarget: 'project',
      definition: { command: 'disabled-mcp' },
      warnings: expect.arrayContaining([
        'The source server is disabled. OpenWaggle imports it disabled.',
      ]),
    })
  })
})
