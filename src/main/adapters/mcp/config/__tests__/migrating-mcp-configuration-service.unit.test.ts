import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getMcpConfigurationOperation,
  setMcpServerEnabledOperation,
} from '../../../../application/mcp-configuration-operations'
import { McpConfigurationService } from '../../../../ports/mcp-configuration-service'
import { WorkspaceProjectAuthorization } from '../../../../ports/workspace-project-authorization'
import { migrateOpenWaggleMcpFiles } from '../../migration/migrate-openwaggle-mcp-files'
import { createFilesystemMcpConfigurationService } from '../filesystem-mcp-configuration-service'
import {
  migrateBeforeEachCall,
  withRuntimeConfigErrors,
} from '../migrating-mcp-configuration-service'

let root: string
let homeDir: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-migrating-'))
  homeDir = path.join(root, 'home')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function layer() {
  const service = createFilesystemMcpConfigurationService({
    homeDir,
    piAgentDir: path.join(homeDir, '.pi', 'agent'),
  })
  const migrate = (projectPath: string | null) =>
    migrateOpenWaggleMcpFiles({
      homeDir,
      projectPaths: projectPath ? [projectPath] : [],
      now: () => new Date('2026-10-01T00:00:00Z'),
    })
  return Layer.mergeAll(
    Layer.succeed(McpConfigurationService, migrateBeforeEachCall(service, migrate)),
    Layer.succeed(
      WorkspaceProjectAuthorization,
      WorkspaceProjectAuthorization.of({ authorize: (projectPath) => Effect.succeed(projectPath) }),
    ),
  )
}

function run<A, E>(
  effect: Effect.Effect<A, E, McpConfigurationService | WorkspaceProjectAuthorization>,
) {
  return Effect.runPromise(Effect.provide(effect, layer()))
}

describe('MCP configuration reads and writes from Settings and the CLI', () => {
  it('see the migrated files, and a later Run start does not undo what the user changed', async () => {
    const owGlobal = path.join(homeDir, '.openwaggle', 'mcp.json')
    // A pre-ADR-0048 file whose server was never turned on: the migration turns it off.
    write(owGlobal, {
      mcpServers: { docs: { url: 'https://docs.example/mcp', directTools: true } },
    })
    write(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), {
      globalState: 'on',
      servers: {},
    })

    const view = await run(getMcpConfigurationOperation({ projectPath: null }))
    // The user turns it on in Settings.
    await run(
      setMcpServerEnabledOperation({
        projectPath: null,
        name: 'docs',
        enabled: true,
        target: 'server',
      }),
    )
    // What a Run's start does: the migration again, which must find the file already handled.
    await migrateOpenWaggleMcpFiles({ homeDir, projectPaths: [], now: () => new Date() })

    expect(view.servers).toEqual([expect.objectContaining({ name: 'docs', enabled: false })])
    expect(JSON.parse(readFileSync(owGlobal, 'utf8')).mcpServers.docs).toEqual({
      url: 'https://docs.example/mcp',
      exposure: 'direct',
    })
  })
})

describe('the MCP configuration view', () => {
  it('reports a server left out of every Run because its vault secret cannot be read', async () => {
    write(path.join(homeDir, '.openwaggle', 'mcp.json'), {
      mcpServers: {
        docs: { url: 'https://d.example', headers: { Authorization: { secret: 'GONE' } } },
      },
    })
    const service = createFilesystemMcpConfigurationService({
      homeDir,
      piAgentDir: path.join(homeDir, '.pi', 'agent'),
    })
    const vaultError = 'mcp.json: server "docs": headers "Authorization" names vault secret "GONE"'
    const merged = (await Effect.runPromise(service.getView({ projectPath: null }))).errors

    const view = await Effect.runPromise(
      withRuntimeConfigErrors(service, async () => [...merged, vaultError]).getView({
        projectPath: null,
      }),
    )

    expect(view.errors).toEqual([...merged, vaultError])
  })
})
