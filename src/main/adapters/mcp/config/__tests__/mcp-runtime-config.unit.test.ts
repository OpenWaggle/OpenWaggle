import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpVaultError } from '../../../../ports/mcp-errors'
import { loadMcpRuntimeConfig } from '../mcp-runtime-config'

let root: string
let homeDir: string
let piAgentDir: string
let projectPath: string

function write(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}

const vault: Readonly<Record<string, string>> = { 'figma-token': 'vault-value' }

async function resolveSecret(name: string) {
  const value = vault[name]
  if (value === undefined) throw new Error('No such secret')
  return value
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-config-'))
  homeDir = path.join(root, 'home')
  piAgentDir = path.join(homeDir, '.pi', 'agent')
  projectPath = path.join(root, 'project')
  mkdirSync(projectPath, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('MCP runtime configuration', () => {
  it('reads the five files, resolves vault references, and names the project override file', async () => {
    write(path.join(piAgentDir, 'mcp.json'), {
      mcpServers: { docs: { url: 'https://docs.example/mcp' } },
    })
    write(path.join(homeDir, '.openwaggle', 'mcp.json'), {
      mcpServers: { figma: { command: 'npx', env: { TOKEN: { secret: 'figma-token' } } } },
    })
    write(path.join(projectPath, '.mcp.json'), {
      mcpServers: { legacy: { type: 'sse', url: 'https://l.example/sse' } },
    })
    write(path.join(projectPath, '.pi', 'mcp.json'), '')
    write(path.join(projectPath, '.openwaggle', 'mcp.json'), {
      mcpServers: { docs: { enabled: false } },
    })

    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir, projectPath },
      resolveSecret,
    })

    expect(config.loaded).toEqual({
      servers: [
        {
          name: 'docs',
          config: { url: 'https://docs.example/mcp', enabled: false },
          source: path.join(piAgentDir, 'mcp.json'),
          scope: 'global',
          override: path.join(projectPath, '.openwaggle', 'mcp.json'),
        },
        {
          name: 'figma',
          config: { command: 'npx', env: { TOKEN: 'vault-value' } },
          source: path.join(homeDir, '.openwaggle', 'mcp.json'),
          scope: 'global',
        },
        {
          name: 'legacy',
          config: { url: 'https://l.example/sse' },
          source: path.join(projectPath, '.mcp.json'),
          scope: 'project',
        },
      ],
      errors: [],
      projectConfig: path.join(projectPath, '.openwaggle', 'mcp.json'),
    })
    expect([...config.transports]).toEqual([
      ['docs', 'http'],
      ['figma', 'stdio'],
      ['legacy', 'sse'],
    ])
  })

  it('reports and skips a server whose vault secret cannot be read', async () => {
    write(path.join(homeDir, '.openwaggle', 'mcp.json'), {
      mcpServers: {
        broken: { url: 'https://b.example', headers: { Authorization: { secret: 'missing' } } },
        fine: { command: 'fine' },
      },
    })

    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir, projectPath: null },
      resolveSecret,
    })

    expect(config.loaded.servers.map((server) => server.name)).toEqual(['fine'])
    expect(config.loaded.projectConfig).toBeUndefined()
    expect(config.loaded.errors).toEqual([
      `${path.join(homeDir, '.openwaggle', 'mcp.json')}: server "broken": headers "Authorization" names vault secret "missing", which could not be read: No such secret`,
    ])
  })

  it('names the servers left out because a secret is missing, apart from other failures', async () => {
    write(path.join(homeDir, '.openwaggle', 'mcp.json'), {
      mcpServers: {
        missing: { command: 'm', env: { TOKEN: { secret: 'ABSENT' } } },
        locked: { command: 'l', env: { TOKEN: { secret: 'LOCKED' } } },
      },
    })

    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir, projectPath: null },
      resolveSecret: async (name) => {
        if (name === 'ABSENT') {
          throw new McpVaultError({ reason: 'secret-not-found', message: 'not found' })
        }
        throw new McpVaultError({ reason: 'decryption-failed', message: 'cannot be decrypted' })
      },
    })

    expect([...config.missingSecrets.keys()]).toEqual(['missing'])
    expect(config.missingSecrets.get('missing')).toBe(config.unavailable.get('missing'))
  })

  it('gives a Session with MCP off no servers, and narrows to an allowlist', async () => {
    write(path.join(piAgentDir, 'mcp.json'), {
      mcpServers: { a: { command: 'a' }, b: { command: 'b' } },
    })
    const roots = { homeDir, piAgentDir, projectPath }

    const off = await loadMcpRuntimeConfig({ roots, resolveSecret, sessionMcpEnabled: false })
    const allowlisted = await loadMcpRuntimeConfig({ roots, resolveSecret, serverAllowlist: ['b'] })

    expect(off.loaded.servers).toEqual([])
    expect(allowlisted.loaded.servers.map((server) => server.name)).toEqual(['b'])
  })

  it('gives Pi no project file for a project at the home folder, whose file is the global one', async () => {
    write(path.join(homeDir, '.openwaggle', 'mcp.json'), { mcpServers: { fs: { command: 'fs' } } })

    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir, projectPath: homeDir },
      resolveSecret,
    })

    // Pi's /mcp "in this project" would otherwise write the global file.
    expect(config.loaded.projectConfig).toBeUndefined()
    expect(config.loaded.servers.map((server) => [server.name, server.scope])).toEqual([
      ['fs', 'global'],
    ])
  })

  it('tells Pi about project overrides only, so /mcp does not call a global one a project file', async () => {
    write(path.join(piAgentDir, 'mcp.json'), {
      mcpServers: { docs: { url: 'https://docs.example/mcp' } },
    })
    write(path.join(homeDir, '.openwaggle', 'mcp.json'), {
      mcpServers: { docs: { exposure: 'direct' } },
    })

    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir, projectPath: null },
      resolveSecret,
    })

    expect(config.loaded.servers[0]?.override).toBeUndefined()
    expect(config.merged.servers[0]?.override?.path).toBe(
      path.join(homeDir, '.openwaggle', 'mcp.json'),
    )
    // Pi's /mcp says changes are "Saved to" the entry's source: that is where they go.
    expect(config.loaded.servers[0]?.source).toBe(path.join(homeDir, '.openwaggle', 'mcp.json'))
  })

  it('does not call the override of a project server a project override of a global one', async () => {
    write(path.join(projectPath, '.mcp.json'), {
      mcpServers: { lint: { command: 'lint-mcp' } },
    })
    write(path.join(projectPath, '.openwaggle', 'mcp.json'), {
      mcpServers: { lint: { enabled: false } },
    })

    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir, projectPath },
      resolveSecret,
    })
    const lint = config.loaded.servers.find((server) => server.name === 'lint')

    expect(lint?.scope).toBe('project')
    expect(lint?.override).toBeUndefined()
    expect(lint?.source).toBe(path.join(projectPath, '.openwaggle', 'mcp.json'))
  })
})
