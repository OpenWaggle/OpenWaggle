import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect, Exit } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFilesystemMcpConfigurationService } from '../filesystem-mcp-configuration-service'

let root: string
let homeDir: string
let projectPath: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-overrides-'))
  homeDir = path.join(root, 'home')
  projectPath = path.join(root, 'project')
  mkdirSync(projectPath, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2))
}

function json(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

const piGlobal = () => path.join(homeDir, '.pi', 'agent', 'mcp.json')
const owGlobal = () => path.join(homeDir, '.openwaggle', 'mcp.json')

function service() {
  return createFilesystemMcpConfigurationService({
    homeDir,
    piAgentDir: path.join(homeDir, '.pi', 'agent'),
  })
}

describe('MCP overrides', () => {
  it("keeps the defining file's tool rules when one tool's exposure changes under an override", async () => {
    write(piGlobal(), {
      mcpServers: { db: { command: 'db-mcp', toolExposure: { 'drop_*': 'hidden' } } },
    })
    write(owGlobal(), { mcpServers: { db: { exposure: 'direct' } } })

    await Effect.runPromise(
      service().setServerExposure({
        projectPath: null,
        name: 'db',
        toolExposure: { query: 'deferred' },
      }),
    )
    const view = await Effect.runPromise(service().getView({ projectPath: null }))

    // An override's toolExposure replaces the one below it, so it starts from the merged rules.
    expect(json(owGlobal())).toEqual({
      mcpServers: {
        db: { exposure: 'direct', toolExposure: { 'drop_*': 'hidden', query: 'deferred' } },
      },
    })
    expect(view.servers[0]?.toolExposure).toEqual({ 'drop_*': 'hidden', query: 'deferred' })
  })

  it('removes the server with its overrides in OpenWaggle files and reports the ones it leaves', async () => {
    const projectPi = path.join(projectPath, '.pi', 'mcp.json')
    const projectOw = path.join(projectPath, '.openwaggle', 'mcp.json')
    write(piGlobal(), { mcpServers: { fs: { command: 'fs-mcp' }, keep: { command: 'k' } } })
    write(owGlobal(), { mcpServers: { fs: { enabled: false }, keep: { enabled: false } } })
    write(projectPi, { mcpServers: { fs: { exposure: 'direct' } } })
    write(projectOw, { mcpServers: { fs: { enabled: true } } })

    await Effect.runPromise(service().removeServer({ projectPath, name: 'fs' }))
    const view = await Effect.runPromise(service().getView({ projectPath }))

    expect(json(piGlobal())).toEqual({ mcpServers: { keep: { command: 'k' } } })
    expect(json(owGlobal())).toEqual({ mcpServers: { keep: { enabled: false } } })
    expect(json(projectOw)).toEqual({ mcpServers: {} })
    // Pi's own project file is left as it is; its now-orphaned override is reported.
    expect(json(projectPi)).toEqual({ mcpServers: { fs: { exposure: 'direct' } } })
    expect(view.errors.join('\n')).toContain(`${projectPi}: server "fs" needs "command" or "url"`)
  })

  it('keeps the overrides when an earlier file still defines the server', async () => {
    write(piGlobal(), { mcpServers: { fs: { command: 'pi-fs' } } })
    const projectOw = path.join(projectPath, '.openwaggle', 'mcp.json')
    write(path.join(projectPath, '.mcp.json'), { mcpServers: { fs: { command: 'shared-fs' } } })
    write(projectOw, { mcpServers: { fs: { enabled: false } } })

    await Effect.runPromise(service().removeServer({ projectPath, name: 'fs' }))

    expect(json(projectOw)).toEqual({ mcpServers: { fs: { enabled: false } } })
  })

  it('removes the project switch when it is turned back to what the files below give', async () => {
    const projectOw = path.join(projectPath, '.openwaggle', 'mcp.json')
    write(piGlobal(), { mcpServers: { fs: { command: 'fs-mcp' } } })
    // Off for this project, then on again with the server's own switch, as Settings > MCP does.
    await Effect.runPromise(
      service().setServerEnabled({ projectPath, name: 'fs', enabled: false, target: 'project' }),
    )
    await Effect.runPromise(
      service().setServerEnabled({ projectPath, name: 'fs', enabled: true, target: 'server' }),
    )
    const view = await Effect.runPromise(service().getView({ projectPath }))

    expect(json(projectOw)).toEqual({ mcpServers: {} })
    expect(view.servers[0]).not.toHaveProperty('override')
    // Turning the server off for every project in Pi now reaches this project too.
    write(piGlobal(), { mcpServers: { fs: { command: 'fs-mcp', enabled: false } } })
    const later = await Effect.runPromise(service().getView({ projectPath }))
    expect(later.servers[0]?.enabled).toBe(false)
  })

  it('keeps the other settings of a project override when only its switch goes back', async () => {
    const projectOw = path.join(projectPath, '.openwaggle', 'mcp.json')
    write(piGlobal(), { mcpServers: { fs: { command: 'fs-mcp', enabled: false } } })
    write(projectOw, { mcpServers: { fs: { enabled: true, exposure: 'direct' } } })

    await Effect.runPromise(
      service().setServerEnabled({ projectPath, name: 'fs', enabled: false, target: 'project' }),
    )

    expect(json(projectOw)).toEqual({ mcpServers: { fs: { exposure: 'direct' } } })
  })

  it('removes an orphaned override from an OpenWaggle file, and only that entry', async () => {
    const projectOw = path.join(projectPath, '.openwaggle', 'mcp.json')
    write(projectOw, { mcpServers: { gone: { enabled: false }, kept: { command: 'k' } } })

    const before = await Effect.runPromise(service().getView({ projectPath }))
    await Effect.runPromise(
      service().removeOrphanedOverride({ projectPath, name: 'gone', fileId: 'project-openwaggle' }),
    )
    const view = await Effect.runPromise(service().getView({ projectPath }))

    expect(before.orphanedOverrides).toEqual([
      { name: 'gone', fileId: 'project-openwaggle', path: projectOw },
    ])
    expect(json(projectOw)).toEqual({ mcpServers: { kept: { command: 'k' } } })
    expect(view.warnings ?? []).toEqual([])
    expect(view.orphanedOverrides ?? []).toEqual([])
  })

  it('does not take a global override for a server a later project file defines as orphaned', async () => {
    // R3's orphan.mts: the override comes before the file that defines the server.
    const mcpJson = path.join(projectPath, '.mcp.json')
    write(owGlobal(), { mcpServers: { db: { enabled: false } } })
    write(mcpJson, { mcpServers: { db: { command: 'db-mcp' } } })

    const view = await Effect.runPromise(service().getView({ projectPath }))
    const refused = await Effect.runPromiseExit(
      service().removeOrphanedOverride({ projectPath, name: 'db', fileId: 'openwaggle-global' }),
    )

    expect(view.servers.map((server) => server.name)).toEqual(['db'])
    expect(view.orphanedOverrides ?? []).toEqual([])
    expect(view.warnings?.join('\n')).toContain(`defined in ${mcpJson}`)
    expect(Exit.isFailure(refused)).toBe(true)
    expect(json(mcpJson)).toEqual({ mcpServers: { db: { command: 'db-mcp' } } })
    expect(json(owGlobal())).toEqual({ mcpServers: { db: { enabled: false } } })
  })

  it('refuses to remove a full entry as an orphaned override', async () => {
    const projectOw = path.join(projectPath, '.openwaggle', 'mcp.json')
    write(projectOw, { mcpServers: { real: { command: 'real-mcp' } } })

    const refused = await Effect.runPromiseExit(
      service().removeOrphanedOverride({ projectPath, name: 'real', fileId: 'project-openwaggle' }),
    )

    expect(Exit.isFailure(refused)).toBe(true)
    expect(json(projectOw)).toEqual({ mcpServers: { real: { command: 'real-mcp' } } })
  })
})
