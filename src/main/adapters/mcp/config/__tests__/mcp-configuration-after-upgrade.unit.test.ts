import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateOpenWaggleMcpFiles } from '../../migration/migrate-openwaggle-mcp-files'
import { createFilesystemMcpConfigurationService } from '../filesystem-mcp-configuration-service'
import { migrateBeforeEachCall } from '../migrating-mcp-configuration-service'

let homeDir: string

beforeEach(() => {
  homeDir = mkdtempSync(path.join(tmpdir(), 'ow-mcp-upgrade-'))
})

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true })
})

function write(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2))
}

describe('Settings > MCP right after an upgrade', () => {
  it('shows the on/off state the old version had, not the files as they were', async () => {
    const piAgentDir = path.join(homeDir, '.pi', 'agent')
    write(path.join(piAgentDir, 'mcp.json'), { mcpServers: { tools: { command: 'tools-mcp' } } })
    write(path.join(homeDir, '.openwaggle', 'mcp.json'), {
      mcpServers: { local: { command: 'local-mcp' } },
    })
    // MCP was off in the old OpenWaggle, so no server ran there.
    write(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), {
      version: 1,
      globalState: 'off',
      projectStates: {},
      sessionStates: {},
      projectServerStates: {},
      servers: {},
    })
    const service = migrateBeforeEachCall(
      createFilesystemMcpConfigurationService({ homeDir, piAgentDir }),
      (projectPath) =>
        migrateOpenWaggleMcpFiles({
          homeDir,
          piAgentDir,
          projectPaths: projectPath ? [projectPath] : [],
          now: () => new Date(),
        }),
    )

    const view = await Effect.runPromise(service.getView({ projectPath: null }))

    expect(view.servers.map((server) => [server.name, server.enabled])).toEqual([
      ['tools', false],
      ['local', false],
    ])
  })
})
