import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AUTOMATION_PROJECT_MCP_NOTICE, connectsProjectMcpServers } from '../mcp-automation-policy'
import { loadMcpRuntimeConfig, mcpLeftOutServerNotice } from '../mcp-runtime-config'

let root: string
let homeDir: string
let piAgentDir: string
let projectPath: string

function write(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2))
}

async function resolveSecret(name: string): Promise<string> {
  throw new Error(`No secret ${name}`)
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-automation-'))
  homeDir = path.join(root, 'home')
  piAgentDir = path.join(homeDir, '.pi', 'agent')
  projectPath = path.join(root, 'project')
  mkdirSync(projectPath, { recursive: true })
  write(path.join(homeDir, '.openwaggle', 'mcp.json'), {
    mcpServers: { fixture: { command: 'qa-fixture' }, muted: { command: 'qa-muted' } },
  })
  // The repository's own `.mcp.json` points chrome-devtools-mcp at the QA app's CDP port.
  write(path.join(projectPath, '.mcp.json'), {
    mcpServers: {
      'electron-devtools': {
        command: 'npx',
        args: ['-y', 'chrome-devtools-mcp@latest', '--browserUrl=http://127.0.0.1:9223'],
      },
    },
  })
  write(path.join(projectPath, '.openwaggle', 'mcp.json'), {
    mcpServers: { muted: { enabled: false } },
  })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('project MCP servers under hidden QA automation', () => {
  it.each([
    ['a normal app', {}, true],
    ['hidden QA automation', { OPENWAGGLE_AUTOMATION: '1' as const }, false],
    [
      'hidden QA automation that asks for them',
      { OPENWAGGLE_AUTOMATION: '1' as const, OPENWAGGLE_AUTOMATION_PROJECT_MCP: '1' as const },
      true,
    ],
  ])('connects project servers in %s: %s', (_name, environment, connects) => {
    expect(connectsProjectMcpServers(environment)).toBe(connects)
  })

  it('starts no server a project file defines, and keeps the project overrides of global servers', async () => {
    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir, projectPath },
      resolveSecret,
      connectProjectServers: false,
    })

    expect(config.loaded.servers.map((server) => [server.name, server.config.enabled])).toEqual([
      ['fixture', undefined],
      ['muted', false],
    ])
    expect(config.loaded.errors).toContain(AUTOMATION_PROJECT_MCP_NOTICE)
    expect(config.transports.has('electron-devtools')).toBe(false)
  })

  it('connects project servers when asked', async () => {
    const config = await loadMcpRuntimeConfig({
      roots: { homeDir, piAgentDir, projectPath },
      resolveSecret,
      connectProjectServers: true,
    })

    expect(config.loaded.servers.map((server) => server.name)).toContain('electron-devtools')
    expect(config.loaded.errors).not.toContain(AUTOMATION_PROJECT_MCP_NOTICE)
  })

  it('says why a project server is not available', () => {
    const roots = { homeDir, piAgentDir, projectPath }

    expect(mcpLeftOutServerNotice(roots, 'electron-devtools', false)).toBe(
      AUTOMATION_PROJECT_MCP_NOTICE,
    )
    expect(mcpLeftOutServerNotice(roots, 'electron-devtools', true)).toBeUndefined()
    expect(mcpLeftOutServerNotice(roots, 'fixture', false)).toBeUndefined()
  })
})
