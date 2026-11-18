import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getMcpConfigurationOperation,
  setMcpServerEnabledOperation,
} from '../../../../application/mcp-configuration-operations'
import { McpConfigurationService } from '../../../../ports/mcp-configuration-service'
import { WorkspaceProjectAuthorization } from '../../../../ports/workspace-project-authorization'
import { migrateOpenWaggleMcpFiles } from '../../migration/migrate-openwaggle-mcp-files'
import { pendingMcpFileMigration } from '../../migration/migration-health'
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
    Layer.succeed(
      McpConfigurationService,
      migrateBeforeEachCall(service, migrate, {
        pendingMigration: (projectPath, scope) =>
          pendingMcpFileMigration(homeDir, projectPath, scope),
      }),
    ),
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
    // A pre-ADR-0051 file whose server was never turned on: the migration turns it off.
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

describe('an MCP configuration write while the migration is failing', () => {
  it('is refused, so the migration cannot undo it, and works once the migration succeeded', async () => {
    const project = path.join(root, 'project')
    const dotfiles = path.join(root, 'dotfiles', 'openwaggle')
    mkdirSync(project, { recursive: true })
    // The project's .openwaggle is in a dotfiles checkout that is not mounted: its migration fails.
    symlinkSync(dotfiles, path.join(project, '.openwaggle'))
    write(path.join(project, '.mcp.json'), { mcpServers: { docs: { command: 'docs-mcp' } } })
    write(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), {
      globalState: 'on',
      servers: {},
    })
    // The old OpenWaggle never turned docs on, so its migration turns it off; the user turns it on.
    const turnOn = setMcpServerEnabledOperation({
      projectPath: project,
      name: 'docs',
      enabled: true,
      target: 'project',
    })

    const refused = await Effect.runPromise(Effect.flip(Effect.provide(turnOn, layer())))
    // A missing folder lasts until the user mounts or fixes it, so the refusal says what to fix.
    expect(refused.message).toContain(`Fix it: ${path.join(project, '.openwaggle', 'mcp.json')}`)

    // Mounted again, with the old OpenWaggle file: the next call migrates it, then writes.
    write(path.join(dotfiles, 'mcp.json'), { mcpServers: {} })
    const view = await run(turnOn)
    await migrateOpenWaggleMcpFiles({ homeDir, projectPaths: [project], now: () => new Date() })

    expect(view.servers).toEqual([expect.objectContaining({ name: 'docs', enabled: true })])
    // A Run's start migrates again and finds the file handled: the user's choice stays.
    const after = await run(getMcpConfigurationOperation({ projectPath: project }))
    expect(after.servers).toEqual([expect.objectContaining({ name: 'docs', enabled: true })])
  })
})

describe("a global server's write from a project whose own file is not migrated yet", () => {
  it('goes through when that project keeps no old state: it changes only the global file', async () => {
    const project = path.join(root, 'project')
    mkdirSync(project, { recursive: true })
    symlinkSync(path.join(root, 'unmounted'), path.join(project, '.openwaggle'))
    const owGlobal = path.join(homeDir, '.openwaggle', 'mcp.json')
    write(owGlobal, { mcpServers: { docs: { command: 'docs-mcp' } } })
    write(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), {
      globalState: 'on',
      servers: {},
    })
    // The first run decided which projects keep their old on/off; this one was added later.
    await run(getMcpConfigurationOperation({ projectPath: null }))
    const toggle = (target: 'server' | 'project') =>
      setMcpServerEnabledOperation({ projectPath: project, name: 'docs', enabled: true, target })

    await run(toggle('server'))
    const projectOnly = await Effect.runPromise(
      Effect.flip(Effect.provide(toggle('project'), layer())),
    )

    expect(JSON.parse(readFileSync(owGlobal, 'utf8')).mcpServers.docs).toEqual({
      command: 'docs-mcp',
    })
    // A toggle for this project only would go into the file that is not migrated: refused,
    // though its migration only converts the format, as its link cannot be written through.
    expect(projectOnly.message).toContain('links to a missing')
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
      withRuntimeConfigErrors(service, async () => ({
        errors: [...merged, vaultError],
        missingSecretErrors: [vaultError],
      })).getView({ projectPath: null }),
    )

    expect(view.errors).toEqual([...merged, vaultError])
    // Settings shows those on the servers' rows ("Needs secret"); the CLI lists them all.
    expect(view.missingSecretErrors).toEqual([vaultError])
  })

  it('answers a read from the current files while the Host drains, migrating nothing', async () => {
    const service = createFilesystemMcpConfigurationService({
      homeDir,
      piAgentDir: path.join(homeDir, '.pi', 'agent'),
    })
    const migrate = vi.fn(() => new Promise<void>(() => {}))
    let draining = true
    const migrating = migrateBeforeEachCall(service, migrate, { skipReadsWhile: () => draining })

    // A Settings poll during an update drain neither waits for nor starts the migration.
    await expect(Effect.runPromise(migrating.getView({ projectPath: null }))).resolves.toEqual(
      expect.objectContaining({ servers: [] }),
    )
    expect(migrate).not.toHaveBeenCalled()

    draining = false
    void Effect.runPromise(migrating.getView({ projectPath: null }))
    await vi.waitFor(() => expect(migrate).toHaveBeenCalledOnce())
  })
})
