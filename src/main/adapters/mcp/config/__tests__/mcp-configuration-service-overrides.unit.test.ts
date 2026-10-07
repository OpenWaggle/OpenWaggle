import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
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
})
