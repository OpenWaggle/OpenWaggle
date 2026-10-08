import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveConfigValueOrThrow } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMcpRuntimeConfig } from '../../../mcp/config/mcp-runtime-config'

const vault: Readonly<Record<string, string>> = {
  dollar: 'p@ss$word',
  bang: '!echo PWNED',
  braces: `\${HOME}`,
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('vault secrets in the configuration Pi receives', () => {
  it(`reads back exactly as stored through Pi’s resolver, never as \${VAR} or !command`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-secrets-'))
    roots.push(root)
    const homeDir = path.join(root, 'home')
    mkdirSync(path.join(homeDir, '.openwaggle'), { recursive: true })
    writeFileSync(
      path.join(homeDir, '.openwaggle', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          local: {
            command: 'tool',
            env: { A: { secret: 'dollar' }, B: { secret: 'bang' }, C: { secret: 'braces' } },
          },
          remote: { url: 'https://r.example', headers: { Authorization: { secret: 'bang' } } },
        },
      }),
    )

    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir: path.join(homeDir, '.pi', 'agent'), projectPath: null },
      resolveSecret: async (name) => vault[name] ?? '',
    })
    const values = config.loaded.servers.flatMap((server) =>
      Object.values(
        'url' in server.config ? (server.config.headers ?? {}) : (server.config.env ?? {}),
      ),
    )

    // Pi's own resolver is what the transports run these values through.
    expect(values.map((value) => resolveConfigValueOrThrow(value, 'value'))).toEqual([
      'p@ss$word',
      '!echo PWNED',
      `\${HOME}`,
      '!echo PWNED',
    ])
  })
})
