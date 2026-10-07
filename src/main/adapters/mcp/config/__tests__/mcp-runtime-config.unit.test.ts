import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
})
