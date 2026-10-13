import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect, Exit } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { McpAddServerInput } from '../../../../ports/mcp-configuration-service'
import { createFilesystemMcpConfigurationService } from '../filesystem-mcp-configuration-service'

let root: string
let homeDir: string
let projectPath: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-guards-'))
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

const piGlobal = () => path.join(homeDir, '.pi', 'agent', 'mcp.json')
const owGlobal = () => path.join(homeDir, '.openwaggle', 'mcp.json')

function service() {
  return createFilesystemMcpConfigurationService({
    homeDir,
    piAgentDir: path.join(homeDir, '.pi', 'agent'),
  })
}

async function failure(effect: Effect.Effect<void, unknown>) {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return 'succeeded'
  return JSON.stringify(exit.cause)
}

function add(input: Partial<McpAddServerInput> & Pick<McpAddServerInput, 'name' | 'entry'>) {
  return service().addServer({ projectPath, scope: 'global', ...input })
}

describe('adding MCP servers', () => {
  it('refuses a name another file already uses, also as a - / _ variant', async () => {
    write(piGlobal(), { mcpServers: { 'dev-radius': { command: 'dr' } } })

    expect(await failure(add({ name: 'dev-radius', entry: { command: 'x' } }))).toContain(
      'already configured',
    )
    expect(await failure(add({ name: 'dev_radius', entry: { command: 'x' } }))).toContain(
      'already configured',
    )
  })

  it('replaces an entry only when asked to, and never a look-alike name', async () => {
    write(owGlobal(), { mcpServers: { 'my-docs': { url: 'https://old.example' } } })

    const unasked = await failure(add({ name: 'my-docs', entry: { url: 'https://new.example' } }))
    await Effect.runPromise(
      add({ name: 'my-docs', entry: { url: 'https://new.example' }, replace: true }),
    )
    const lookAlike = await failure(
      add({ name: 'my_docs', entry: { command: 'x' }, replace: true }),
    )

    expect(unasked).toContain('already configured')
    expect(JSON.parse(readFileSync(owGlobal(), 'utf8')).mcpServers['my-docs']).toEqual({
      url: 'https://new.example',
    })
    expect(lookAlike).toContain('already configured')
  })

  it('refuses a destination of the other scope and auth in a project file', async () => {
    const wrongScope = await failure(
      add({
        name: 'a',
        entry: { command: 'a' },
        scope: 'global',
        destination: 'project-openwaggle',
      }),
    )
    const projectAuth = await failure(
      add({
        name: 'b',
        scope: 'project',
        entry: { url: 'https://b.example', auth: { provider: 'github' } },
      }),
    )

    expect(wrongScope).toContain('is a project file')
    expect(projectAuth).toContain('auth is only allowed in a global mcp.json')
  })

  it("writes an SSE or WebSocket server only to OpenWaggle's files, which Pi does not read", async () => {
    const sseInPi = await failure(
      add({
        name: 'old-sse',
        entry: { type: 'sse', url: 'https://sse.example' },
        destination: 'pi-global',
      }),
    )
    const wsInShared = await failure(
      add({
        name: 'old-ws',
        scope: 'project',
        entry: { type: 'websocket', url: 'wss://ws.example' },
        destination: 'project-mcp-json',
      }),
    )
    // A ws:// or wss:// URL is a WebSocket server without a `type`.
    const untypedWsInPi = await failure(
      add({ name: 'bare-ws', entry: { url: 'wss://ws.example' }, destination: 'pi-global' }),
    )
    await Effect.runPromise(
      add({ name: 'ok-sse', entry: { type: 'sse', url: 'https://sse.example' } }),
    )

    expect(sseInPi).toContain('Pi cannot read an sse server')
    expect(wsInShared).toContain('Pi cannot read a websocket server')
    expect(untypedWsInPi).toContain('Pi cannot read a websocket server')
    expect(existsSync(piGlobal()) && readFileSync(piGlobal(), 'utf8').includes('bare-ws')).toBe(
      false,
    )
    expect(JSON.parse(readFileSync(owGlobal(), 'utf8')).mcpServers['ok-sse']).toMatchObject({
      type: 'sse',
    })
  })
})

describe('switching a server for one project', () => {
  it('refuses to save the switch to a global file', async () => {
    write(piGlobal(), { mcpServers: { fs: { command: 'fs' } } })

    const result = await failure(
      service().setServerEnabled({
        projectPath,
        name: 'fs',
        enabled: false,
        target: 'project',
        destination: 'openwaggle-global',
      }),
    )

    expect(result).toContain('is a global file')
  })
})

describe('a project that is the home folder', () => {
  it('reads ~/.openwaggle/mcp.json once, as the global file', async () => {
    write(owGlobal(), { mcpServers: { fs: { command: 'fs' } } })

    const view = await Effect.runPromise(service().getView({ projectPath: homeDir }))

    expect(
      view.files.filter((file) => file.path === owGlobal()).map((file) => file.fileId),
    ).toEqual(['openwaggle-global'])
    expect(view.servers.map((server) => [server.name, server.source.fileId])).toEqual([
      ['fs', 'openwaggle-global'],
    ])
    expect(view.errors).toEqual([])
  })

  it('refuses a per-project write to the file that is also the global file', async () => {
    write(piGlobal(), { mcpServers: { fs: { command: 'fs' } } })

    const result = await failure(
      service().setServerEnabled({
        projectPath: homeDir,
        name: 'fs',
        enabled: false,
        target: 'project',
      }),
    )

    expect(result).toContain('home folder')
  })

  it('explains the refusal for a project whose .openwaggle folder links to the global one', async () => {
    write(owGlobal(), { mcpServers: { fs: { command: 'fs' } } })
    mkdirSync(projectPath, { recursive: true })
    symlinkSync(path.join(homeDir, '.openwaggle'), path.join(projectPath, '.openwaggle'))

    const result = await failure(
      service().setServerEnabled({ projectPath, name: 'fs', enabled: false, target: 'project' }),
    )

    expect(result).toContain("This project's .openwaggle folder is the global one")
  })
})
