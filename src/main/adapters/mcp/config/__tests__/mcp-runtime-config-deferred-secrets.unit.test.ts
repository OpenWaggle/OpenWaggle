import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveDeferredMcpSecrets } from '../mcp-deferred-secrets'
import { loadMcpRuntimeConfig } from '../mcp-runtime-config'

let root: string
let homeDir: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-deferred-'))
  homeDir = path.join(root, 'home')
  const filePath = path.join(homeDir, '.openwaggle', 'mcp.json')
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(
    filePath,
    JSON.stringify({
      mcpServers: {
        off: { command: 'off-mcp', enabled: false, env: { TOKEN: { secret: 'OFF_TOKEN' } } },
        on: { command: 'on-mcp', env: { TOKEN: { secret: 'ON_TOKEN' } } },
      },
    }),
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const vault: Readonly<Record<string, string>> = { OFF_TOKEN: 'off-value', ON_TOKEN: 'on-value' }

describe("a Run's servers that are off", () => {
  it('read their vault secrets only when Pi connects them', async () => {
    const resolveSecret = vi.fn(async (name: string) => vault[name] ?? '')

    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir: path.join(homeDir, '.pi', 'agent'), projectPath: null },
      resolveSecret,
      deferSecretsOfServersOff: true,
    })

    // Pi's /mcp may turn it on during the Run, so it is still given to Pi.
    expect(config.loaded.servers.map((server) => server.name)).toEqual(['off', 'on'])
    expect(resolveSecret.mock.calls.map(([name]) => name)).toEqual(['ON_TOKEN'])
    const off = config.loaded.servers.find((server) => server.name === 'off')
    if (!off) throw new Error('missing')
    expect(JSON.stringify(off.config)).not.toContain('off-value')

    const connected = await resolveDeferredMcpSecrets(off.config, resolveSecret)
    expect('env' in connected ? connected.env : undefined).toEqual({ TOKEN: 'off-value' })
  })

  it('fail to connect when the deferred secret cannot be read', async () => {
    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir: path.join(homeDir, '.pi', 'agent'), projectPath: null },
      resolveSecret: async () => 'value',
      deferSecretsOfServersOff: true,
    })
    const off = config.loaded.servers.find((server) => server.name === 'off')
    if (!off) throw new Error('missing')

    await expect(
      resolveDeferredMcpSecrets(off.config, async () => {
        throw new Error('No such secret')
      }),
    ).rejects.toThrow('names vault secret "OFF_TOKEN", which could not be read: No such secret')
  })

  it('give a server the same connection identity whether its secrets were deferred or read', async () => {
    const roots = { homeDir, piAgentDir: path.join(homeDir, '.pi', 'agent'), projectPath: null }
    const secretStamp = async (name: string) => `${name}@1700000000000`
    const resolveSecret = async (name: string) => vault[name] ?? ''

    // This Run started with it off; /mcp turned it on, and the next Run starts with it on.
    const deferred = await loadMcpRuntimeConfig({
      roots,
      resolveSecret,
      secretStamp,
      deferSecretsOfServersOff: true,
    })
    const read = await loadMcpRuntimeConfig({ roots, resolveSecret, secretStamp })

    expect(deferred.connectionConfigs.get('off')).toEqual(read.connectionConfigs.get('off'))
    expect(JSON.stringify(read.connectionConfigs.get('off'))).not.toContain('off-value')
    // A secret saved again changes it, so the connection restarts with the new value.
    const saved = await loadMcpRuntimeConfig({
      roots,
      resolveSecret,
      secretStamp: async (name) => `${name}@1700000009999`,
    })
    expect(saved.connectionConfigs.get('off')).not.toEqual(read.connectionConfigs.get('off'))
  })
})
