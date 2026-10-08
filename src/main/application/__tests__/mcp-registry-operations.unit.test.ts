import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cause, Effect, Exit, Layer, Option } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFilesystemMcpConfigurationService } from '../../adapters/mcp/config/filesystem-mcp-configuration-service'
import { createMcpRegistryService } from '../../adapters/mcp/registry/mcp-registry-service'
import { McpConfigurationService } from '../../ports/mcp-configuration-service'
import { McpRegistryService } from '../../ports/mcp-registry-service'
import { McpSecretVaultService } from '../../ports/mcp-secret-vault-service'
import { WorkspaceProjectAuthorization } from '../../ports/workspace-project-authorization'
import {
  installMcpRegistryServerOperation,
  searchMcpRegistryOperation,
} from '../mcp-registry-operations'

const WEATHER = {
  name: 'io.github.example/weather',
  version: '2.0.0',
  description: 'Weather forecasts.',
  remotes: [
    {
      type: 'streamable-http',
      url: 'https://weather.example/mcp',
      headers: [{ name: 'Authorization', isSecret: true }],
    },
  ],
  packages: [
    {
      registryType: 'npm',
      identifier: '@example/weather',
      version: '1.2.3',
      transport: { type: 'stdio' },
    },
  ],
}
const LATEST = { 'io.modelcontextprotocol.registry/official': { isLatest: true } }

let root = ''
let homeDir = ''
let projectPath = ''
const requests: URL[] = []
const vaultSecrets: string[] = []

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-registry-operations-'))
  homeDir = path.join(root, 'home')
  projectPath = path.join(root, 'project')
  mkdirSync(projectPath, { recursive: true })
  requests.length = 0
  vaultSecrets.length = 0
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const fetchResource = vi.fn(async (url: URL) => {
  requests.push(url)
  return Response.json({ servers: [{ server: WEATHER, _meta: LATEST }] })
})

function layer() {
  return Layer.mergeAll(
    Layer.succeed(
      McpConfigurationService,
      createFilesystemMcpConfigurationService({
        homeDir,
        piAgentDir: path.join(homeDir, '.pi', 'agent'),
      }),
    ),
    Layer.succeed(McpRegistryService, createMcpRegistryService({ homeDir, fetchResource })),
    Layer.succeed(
      McpSecretVaultService,
      McpSecretVaultService.of({
        list: () =>
          Effect.succeed(vaultSecrets.map((name) => ({ name, createdAt: 1, updatedAt: 1 }))),
        resolve: () => Effect.die('not read'),
        set: () => Effect.die('not written'),
        remove: () => Effect.die('not written'),
      }),
    ),
    Layer.succeed(
      WorkspaceProjectAuthorization,
      WorkspaceProjectAuthorization.of({
        authorize: (candidate) =>
          candidate === projectPath
            ? Effect.succeed(candidate)
            : Effect.fail(new Error('Project path is not authorized for workspace access.')),
      }),
    ),
  )
}

type Services =
  | McpConfigurationService
  | McpRegistryService
  | McpSecretVaultService
  | WorkspaceProjectAuthorization

function run<A, E>(effect: Effect.Effect<A, E, Services>) {
  return Effect.runPromise(Effect.provide(effect, layer()))
}

async function failureMessage<A, E>(effect: Effect.Effect<A, E, Services>) {
  const exit = await Effect.runPromiseExit(Effect.provide(effect, layer()))
  if (Exit.isSuccess(exit)) throw new Error('Expected the operation to fail.')
  const error = Option.getOrUndefined(Cause.failureOption(exit.cause))
  return error instanceof Error ? error.message : String(error)
}

function servers(filePath: string): Record<string, unknown> {
  const parsed: { mcpServers: Record<string, unknown> } = JSON.parse(readFileSync(filePath, 'utf8'))
  return parsed.mcpServers
}

describe('MCP Registry operations', () => {
  it('searches the official Registry and describes how each server can run', async () => {
    const result = await run(searchMcpRegistryOperation({ query: 'weather' }))

    expect(requests[0]?.href).toBe(
      'https://registry.modelcontextprotocol.io/v0.1/servers?search=weather&limit=20',
    )
    expect(result.servers).toEqual([
      expect.objectContaining({
        name: 'io.github.example/weather',
        suggestedName: 'weather',
        installOptions: [
          { method: 'remote', target: 'https://weather.example/mcp' },
          { method: 'npm', target: '@example/weather@1.2.3' },
        ],
      }),
    ])
  })

  it("installs an ordinary Pi entry into OpenWaggle's global file", async () => {
    const result = await run(
      installMcpRegistryServerOperation({
        projectPath: null,
        registryName: 'io.github.example/weather',
        scope: 'global',
      }),
    )

    const filePath = path.join(homeDir, '.openwaggle', 'mcp.json')
    expect(servers(filePath)).toEqual({
      weather: {
        url: 'https://weather.example/mcp',
        // Named after the server: another server's Authorization is another secret.
        headers: { Authorization: { secret: 'WEATHER_AUTHORIZATION' } },
        description: 'Weather forecasts.',
      },
    })
    expect(result).toMatchObject({
      name: 'weather',
      filePath,
      secrets: ['WEATHER_AUTHORIZATION'],
      existingSecrets: [],
    })
    expect(result.view.servers.map((server) => server.name)).toEqual(['weather'])
  })

  it('names the secrets after the chosen name, and says which ones already exist', async () => {
    vaultSecrets.push('WORK_WEATHER_AUTHORIZATION')

    const result = await run(
      installMcpRegistryServerOperation({
        projectPath: null,
        registryName: 'io.github.example/weather',
        scope: 'global',
        serverName: 'work-weather',
      }),
    )

    expect(servers(path.join(homeDir, '.openwaggle', 'mcp.json'))).toMatchObject({
      'work-weather': { headers: { Authorization: { secret: 'WORK_WEATHER_AUTHORIZATION' } } },
    })
    expect(result).toMatchObject({
      secrets: ['WORK_WEATHER_AUTHORIZATION'],
      existingSecrets: ['WORK_WEATHER_AUTHORIZATION'],
    })
  })

  it("installs a package for one project into the project's OpenWaggle file", async () => {
    await run(
      installMcpRegistryServerOperation({
        projectPath,
        registryName: 'io.github.example/weather',
        scope: 'project',
        method: 'npm',
        serverName: 'forecast',
        exposure: 'direct',
      }),
    )

    expect(servers(path.join(projectPath, '.openwaggle', 'mcp.json'))).toEqual({
      forecast: {
        command: 'npx',
        args: ['--yes', '@example/weather@1.2.3'],
        description: 'Weather forecasts.',
        exposure: 'direct',
      },
    })
  })

  it('refuses a name that is already configured, before downloading anything', async () => {
    await run(
      installMcpRegistryServerOperation({
        projectPath: null,
        registryName: 'io.github.example/weather',
        scope: 'global',
      }),
    )
    requests.length = 0

    await expect(
      failureMessage(
        installMcpRegistryServerOperation({
          projectPath: null,
          registryName: 'io.github.example/weather',
          scope: 'global',
          serverName: 'weather',
        }),
      ),
    ).resolves.toMatch(/already configured/)
    expect(requests).toEqual([])
  })

  it('accepts a project only when OpenWaggle knows it', async () => {
    await expect(
      failureMessage(
        installMcpRegistryServerOperation({
          projectPath: '/not-a-known-project',
          registryName: 'io.github.example/weather',
          scope: 'project',
        }),
      ),
    ).resolves.toMatch(/Open this project in OpenWaggle/)
    await expect(
      failureMessage(
        installMcpRegistryServerOperation({
          projectPath: null,
          registryName: 'io.github.example/weather',
          scope: 'project',
        }),
      ),
    ).resolves.toMatch(/Choose a project/)
  })

  it('reports a server the Registry does not have', async () => {
    await expect(
      failureMessage(
        installMcpRegistryServerOperation({
          projectPath: null,
          registryName: 'io.github.example/missing',
          scope: 'global',
        }),
      ),
    ).resolves.toMatch(/was not found/)
  })
})
