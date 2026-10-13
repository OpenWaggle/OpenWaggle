import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect, Exit } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFilesystemMcpConfigurationService } from '../filesystem-mcp-configuration-service'

let root: string
let homeDir: string
let piAgentDir: string
let projectPath: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-service-'))
  homeDir = path.join(root, 'home')
  piAgentDir = path.join(homeDir, '.pi', 'agent')
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

const piGlobal = () => path.join(piAgentDir, 'mcp.json')
const owGlobal = () => path.join(homeDir, '.openwaggle', 'mcp.json')
const owProject = () => path.join(projectPath, '.openwaggle', 'mcp.json')

function service() {
  return createFilesystemMcpConfigurationService({ homeDir, piAgentDir })
}

describe('filesystem MCP configuration service', () => {
  it('describes each server with its file, state, exposure, and OAuth use', async () => {
    write(piGlobal(), {
      mcpServers: {
        sentry: { url: 'https://mcp.sentry.dev/mcp' },
        docs: { url: 'https://d.example', headers: { Authorization: 'Bearer x' } },
        fs: { command: 'npx', args: ['-y', 'server-fs', '.'], exposure: 'direct' },
      },
    })
    write(owProject(), { mcpServers: { fs: { enabled: false } } })

    const view = await Effect.runPromise(service().getView({ projectPath }))

    expect(view.servers).toEqual([
      expect.objectContaining({
        name: 'sentry',
        usesOAuth: true,
        exposure: 'codemode',
        enabled: true,
      }),
      expect.objectContaining({ name: 'docs', usesOAuth: false }),
      {
        name: 'fs',
        transport: 'stdio',
        target: 'npx -y server-fs .',
        source: { fileId: 'pi-global', path: piGlobal() },
        scope: 'global',
        override: { fileId: 'project-openwaggle', path: owProject() },
        offByOverride: true,
        enabled: false,
        exposure: 'direct',
        toolExposure: {},
        usesOAuth: false,
      },
    ])
    expect(view.files.map((file) => [file.fileId, file.exists, file.openWaggleOwned])).toEqual([
      ['pi-global', true, false],
      ['openwaggle-global', false, true],
      ['project-mcp-json', false, false],
      ['project-pi', false, false],
      ['project-openwaggle', true, true],
    ])
  })

  it('names the vault secrets a server reads, never their values', async () => {
    write(owGlobal(), {
      mcpServers: {
        api: { command: 'api-mcp', env: { TOKEN: { secret: 'API_TOKEN' }, MODE: 'fast' } },
        web: {
          url: 'https://w.example/mcp',
          headers: { Authorization: { secret: 'WEB_AUTH' }, 'X-Key': { secret: 'API_TOKEN' } },
        },
        plain: { command: 'plain-mcp' },
      },
    })

    const view = await Effect.runPromise(service().getView({ projectPath: null }))

    expect(view.servers.map((server) => [server.name, server.vaultSecrets])).toEqual([
      ['api', ['API_TOKEN']],
      ['web', ['API_TOKEN', 'WEB_AUTH']],
      ['plain', undefined],
    ])
  })

  it("switches a global server for one project in OpenWaggle's project file", async () => {
    write(piGlobal(), { mcpServers: { fs: { command: 'fs' } } })
    const changed: string[] = []
    const configuration = service()
    configuration.onChange((filePath) => changed.push(filePath))

    await Effect.runPromise(
      configuration.setServerEnabled({
        projectPath,
        name: 'fs',
        enabled: false,
        target: 'project',
      }),
    )

    expect(json(owProject())).toEqual({ mcpServers: { fs: { enabled: false } } })
    expect(json(piGlobal())).toEqual({ mcpServers: { fs: { command: 'fs' } } })
    expect(changed).toEqual([owProject()])
  })

  it('saves a change to an existing server to the file that defines it', async () => {
    write(piGlobal(), { mcpServers: { fs: { command: 'fs' } } })

    await Effect.runPromise(
      service().setServerExposure({ projectPath: null, name: 'fs', exposure: 'deferred' }),
    )

    expect(json(piGlobal())).toEqual({
      mcpServers: { fs: { command: 'fs', exposure: 'deferred' } },
    })
  })

  it("adds new servers to OpenWaggle's file for the scope unless another is picked", async () => {
    const configuration = service()

    await Effect.runPromise(
      configuration.addServer({
        projectPath,
        name: 'docs',
        scope: 'global',
        entry: { url: 'https://d.example', headers: { Authorization: { secret: 'docs' } } },
      }),
    )
    await Effect.runPromise(
      configuration.addServer({
        projectPath,
        name: 'tools',
        scope: 'project',
        destination: 'project-pi',
        entry: { command: 'tools' },
      }),
    )
    const refused = await Effect.runPromiseExit(
      configuration.addServer({
        projectPath,
        name: 'leaky',
        scope: 'project',
        destination: 'project-mcp-json',
        entry: { command: 'x', env: { KEY: { secret: 'k' } } },
      }),
    )

    expect(json(owGlobal())).toEqual({
      mcpServers: {
        docs: { url: 'https://d.example', headers: { Authorization: { secret: 'docs' } } },
      },
    })
    expect(json(path.join(projectPath, '.pi', 'mcp.json'))).toEqual({
      mcpServers: { tools: { command: 'tools' } },
    })
    expect(Exit.isFailure(refused)).toBe(true)
  })

  it("removes a server from its file together with OpenWaggle's override", async () => {
    write(piGlobal(), { mcpServers: { fs: { command: 'fs' }, keep: { command: 'k' } } })
    write(owProject(), { mcpServers: { fs: { exposure: 'direct' } } })

    await Effect.runPromise(service().removeServer({ projectPath, name: 'fs' }))

    expect(json(piGlobal())).toEqual({ mcpServers: { keep: { command: 'k' } } })
    // Emptied, OpenWaggle's project file is removed.
    expect(existsSync(owProject())).toBe(false)
  })

  it("removes a global server's overrides from every project OpenWaggle knows", async () => {
    const other = path.join(root, 'other')
    const otherOverride = path.join(other, '.openwaggle', 'mcp.json')
    write(owGlobal(), { mcpServers: { fs: { command: 'fs' } } })
    write(otherOverride, { mcpServers: { fs: { enabled: false }, own: { command: 'own' } } })
    const sweeping = createFilesystemMcpConfigurationService({
      homeDir,
      piAgentDir,
      knownProjectPaths: async () => [other, projectPath],
    })

    await Effect.runPromise(sweeping.removeServer({ projectPath: null, name: 'fs' }))

    expect(json(otherOverride)).toEqual({ mcpServers: { own: { command: 'own' } } })
  })

  it('fails for a server that is not configured', async () => {
    const exit = await Effect.runPromiseExit(
      service().setServerExposure({ projectPath: null, name: 'ghost', exposure: 'direct' }),
    )

    expect(exit).toEqual(
      Exit.fail(
        expect.objectContaining({
          reason: 'not-found',
          message: 'No MCP server named "ghost" is configured.',
        }),
      ),
    )
  })
})
