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
})
