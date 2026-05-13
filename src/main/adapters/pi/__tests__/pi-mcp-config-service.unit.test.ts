import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  MCP_ADAPTER_LEGACY_PACKAGE_SOURCES,
  MCP_ADAPTER_PACKAGE_SOURCE,
  MCP_CONFIG,
} from '@shared/constants/mcp'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigFileSchema, piAgentSettingsFileSchema } from '@shared/schemas/mcp'
import type { McpConfigFile, PiAgentSettingsFile } from '@shared/types/mcp'
import { describe, expect, it } from 'vitest'
import {
  createPiMcpConfigServiceForTests,
  withOpenWaggleMcpAdapterProcessContext,
} from '../pi-mcp-config-service'

async function writeJson(
  filePath: string,
  value: McpConfigFile | PiAgentSettingsFile,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    `${JSON.stringify(value, null, MCP_CONFIG.JSON_INDENT_SPACES)}\n`,
    'utf-8',
  )
}

async function writeText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, value, 'utf-8')
}

async function readMcpConfig(filePath: string): Promise<McpConfigFile> {
  const parsed: unknown = JSON.parse(await readFile(filePath, 'utf-8'))
  return decodeUnknownOrThrow(mcpConfigFileSchema, parsed)
}

async function readPiSettings(filePath: string): Promise<PiAgentSettingsFile> {
  const parsed: unknown = JSON.parse(await readFile(filePath, 'utf-8'))
  return decodeUnknownOrThrow(piAgentSettingsFileSchema, parsed)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface McpFixture {
  readonly root: string
  readonly home: string
  readonly agentDir: string
  readonly project: string
}

async function withFixture<T>(fn: (fixture: McpFixture) => Promise<T>) {
  const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-'))
  const fixture = {
    root,
    home: path.join(root, 'home'),
    agentDir: path.join(root, 'pi-agent'),
    project: path.join(root, 'project'),
  }
  try {
    return await fn(fixture)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('Pi MCP config service', () => {
  it('merges all MCP config sources into an effective config with OpenWaggle project precedence', () =>
    withFixture(async ({ home, agentDir, project }) => {
      const service = createPiMcpConfigServiceForTests({ homeDir: home, agentDir })

      await writeJson(path.join(home, '.config', 'mcp', 'mcp.json'), {
        settings: { toolPrefix: 'server' },
        mcpServers: {
          global: { command: 'global' },
          shared: { command: 'global-shared' },
        },
      })
      await writeJson(path.join(agentDir, 'mcp.json'), {
        mcpServers: {
          piGlobal: { command: 'pi-global' },
          shared: { command: 'pi-global-shared' },
        },
      })
      await writeJson(path.join(project, '.mcp.json'), {
        mcpServers: {
          project: { command: 'project' },
          shared: { command: 'project-shared' },
        },
      })
      await writeJson(path.join(project, '.agents', 'mcp.json'), {
        mcpServers: {
          agents: { command: 'agents' },
          shared: { command: 'agents-shared' },
        },
      })
      await writeJson(path.join(project, '.pi', 'mcp.json'), {
        mcpServers: {
          piProject: { command: 'pi-project' },
          shared: { command: 'pi-project-shared' },
        },
      })
      await writeJson(path.join(project, '.openwaggle', 'agent', 'mcp.json'), {
        settings: { toolPrefix: 'short' },
        mcpServers: {
          openwaggle: { command: 'openwaggle' },
          shared: { command: 'openwaggle-shared' },
        },
      })

      const view = await service.getView(project)
      expect(view.sources.map((source) => source.id)).toEqual([
        'global-standard',
        'global-pi',
        'project-standard',
        'project-agents',
        'project-pi',
        'project-openwaggle',
      ])
      expect(view.effective.settings.toolPrefix).toBe('short')
      expect(view.effective.mcpServers.shared?.command).toBe('openwaggle-shared')
      expect(Object.keys(view.effective.mcpServers).sort()).toEqual([
        'agents',
        'global',
        'openwaggle',
        'piGlobal',
        'piProject',
        'project',
        'shared',
      ])

      const generatedPath = await service.prepareEffectiveConfig(project)
      if (!generatedPath) {
        throw new Error('Expected generated MCP config path')
      }
      const generated = await readMcpConfig(generatedPath)
      const generatedServers = generated.mcpServers
      expect(typeof generatedServers).toBe('object')
      expect(view.runtimeConfigPath).toBe(generatedPath)
    }))

  it('enables and disables the adapter package source without deleting MCP config', () =>
    withFixture(async ({ home, agentDir, project }) => {
      const installs: string[] = []
      const service = createPiMcpConfigServiceForTests({
        homeDir: home,
        agentDir,
        installAdapterPackage: async (source) => {
          installs.push(source)
        },
      })

      await writeJson(path.join(agentDir, 'settings.json'), {
        packages: ['npm:other-package@1.0.0'],
      })
      await writeJson(path.join(project, '.mcp.json'), {
        mcpServers: {
          playwright: { command: 'npx', args: ['-y', 'playwright@1.58.2'] },
        },
      })

      const enabled = await service.setAdapterEnabled(true, project)
      expect(enabled.adapter.enabled).toBe(true)
      expect(installs).toEqual([MCP_ADAPTER_PACKAGE_SOURCE])
      expect((await readPiSettings(path.join(agentDir, 'settings.json'))).packages).toEqual([
        'npm:other-package@1.0.0',
        MCP_ADAPTER_PACKAGE_SOURCE,
      ])

      const disabled = await service.setAdapterEnabled(false, project)
      expect(disabled.adapter.enabled).toBe(false)
      expect((await readPiSettings(path.join(agentDir, 'settings.json'))).packages).toEqual([
        'npm:other-package@1.0.0',
      ])
      expect(await readMcpConfig(path.join(project, '.mcp.json'))).toEqual({
        mcpServers: {
          playwright: { command: 'npx', args: ['-y', 'playwright@1.58.2'] },
        },
      })
    }))

  it('normalizes legacy unpinned adapter package sources to the configured package', () =>
    withFixture(async ({ home, agentDir, project }) => {
      const service = createPiMcpConfigServiceForTests({ homeDir: home, agentDir })

      await writeJson(path.join(agentDir, 'settings.json'), {
        packages: ['npm:other-package@1.0.0', MCP_ADAPTER_LEGACY_PACKAGE_SOURCES[0]],
      })

      const enabled = await service.setAdapterEnabled(true, project)
      expect(enabled.adapter.enabled).toBe(true)
      expect((await readPiSettings(path.join(agentDir, 'settings.json'))).packages).toEqual([
        'npm:other-package@1.0.0',
        MCP_ADAPTER_PACKAGE_SOURCE,
      ])
    }))

  it('does not enable the adapter package source when installation fails', () =>
    withFixture(async ({ home, agentDir, project }) => {
      const service = createPiMcpConfigServiceForTests({
        homeDir: home,
        agentDir,
        installAdapterPackage: async () => {
          throw new Error('install failed')
        },
      })

      await writeJson(path.join(agentDir, 'settings.json'), {
        packages: ['npm:other-package@1.0.0'],
      })

      await expect(service.setAdapterEnabled(true, project)).rejects.toThrow('install failed')
      expect((await readPiSettings(path.join(agentDir, 'settings.json'))).packages).toEqual([
        'npm:other-package@1.0.0',
      ])
    }))

  it('prepares an adapter runtime context and scopes adapter process discovery while loading', () =>
    withFixture(async ({ home, agentDir, project }) => {
      const service = createPiMcpConfigServiceForTests({ homeDir: home, agentDir })
      await writeJson(path.join(project, '.openwaggle', 'agent', 'mcp.json'), {
        mcpServers: {
          projectServer: { command: 'project-server' },
        },
      })

      const context = await service.prepareRuntimeContext(project)
      if (!context) {
        throw new Error('Expected MCP runtime context')
      }

      expect(context.configPath).toMatch(
        new RegExp(`^${escapeRegExp(path.join(agentDir, 'openwaggle-mcp'))}`),
      )
      expect(context.configPath.endsWith(path.join('mcp.json'))).toBe(true)
      expect(context.adapterCwd).toBe(path.join(path.dirname(context.configPath), 'adapter-cwd'))
      expect(await readMcpConfig(context.configPath)).toEqual({
        mcpServers: {
          projectServer: { command: 'project-server' },
        },
      })

      const previousCwd = process.cwd()
      const previousArgv = [...process.argv]
      const observed = await withOpenWaggleMcpAdapterProcessContext(context, async () => ({
        cwd: process.cwd(),
        argv: [...process.argv],
      }))

      expect(observed.cwd).toBe(context.adapterCwd)
      expect(observed.argv.slice(-2)).toEqual(['--mcp-config', context.configPath])
      expect(process.cwd()).toBe(previousCwd)
      expect(process.argv).toEqual(previousArgv)
    }))

  it('serializes null-context operations against scoped MCP process globals', () =>
    withFixture(async ({ home, agentDir, project }) => {
      const service = createPiMcpConfigServiceForTests({ homeDir: home, agentDir })
      const context = await service.prepareRuntimeContext(project)
      if (!context) {
        throw new Error('Expected MCP runtime context')
      }

      const previousCwd = process.cwd()
      let releaseScopedOperation: (() => void) | undefined
      let markScopedOperationStarted: (() => void) | undefined
      const scopedOperationFinished = new Promise<void>((release) => {
        releaseScopedOperation = release
      })
      const scopedOperationStarted = new Promise<void>((resolve) => {
        markScopedOperationStarted = resolve
      })
      const scopedOperation = withOpenWaggleMcpAdapterProcessContext(context, async () => {
        expect(process.cwd()).toBe(context.adapterCwd)
        markScopedOperationStarted?.()
        await scopedOperationFinished
      })

      await scopedOperationStarted

      const nullContextOperation = withOpenWaggleMcpAdapterProcessContext(null, async () =>
        process.cwd(),
      )
      releaseScopedOperation?.()

      await expect(nullContextOperation).resolves.toBe(previousCwd)
      await scopedOperation
    }))

  it('toggles only the selected source entry by moving it between active and disabled server maps', () =>
    withFixture(async ({ home, agentDir, project }) => {
      const service = createPiMcpConfigServiceForTests({ homeDir: home, agentDir })
      const projectConfigPath = path.join(project, '.mcp.json')

      await writeJson(projectConfigPath, {
        mcpServers: {
          alpha: { command: 'alpha' },
          beta: { command: 'beta' },
        },
      })

      const disabled = await service.setServerEnabled({
        projectPath: project,
        sourceId: 'project-standard',
        serverName: 'alpha',
        enabled: false,
      })
      expect(disabled.servers.find((server) => server.name === 'alpha')?.enabled).toBe(false)
      expect(await readMcpConfig(projectConfigPath)).toEqual({
        mcpServers: {
          beta: { command: 'beta' },
        },
        openwaggle: {
          disabledMcpServers: {
            alpha: { command: 'alpha' },
          },
        },
      })

      const enabled = await service.setServerEnabled({
        projectPath: project,
        sourceId: 'project-standard',
        serverName: 'alpha',
        enabled: true,
      })
      expect(enabled.servers.find((server) => server.name === 'alpha')?.enabled).toBe(true)
      expect(await readMcpConfig(projectConfigPath)).toEqual({
        mcpServers: {
          beta: { command: 'beta' },
          alpha: { command: 'alpha' },
        },
      })
    }))

  it('surfaces invalid MCP source JSON and refuses to generate a runtime config from it', () =>
    withFixture(async ({ home, agentDir, project }) => {
      const service = createPiMcpConfigServiceForTests({ homeDir: home, agentDir })
      const projectConfigPath = path.join(project, '.mcp.json')
      await writeText(projectConfigPath, '{ "mcpServers": ')

      const view = await service.getView(project)
      const projectSource = view.sources.find((source) => source.id === 'project-standard')

      expect(projectSource?.parseError).toMatch(/Invalid MCP JSON config/)
      expect(projectSource?.rawJson).toBe('{ "mcpServers": ')
      await expect(service.prepareEffectiveConfig(project)).rejects.toThrow(
        /Fix invalid MCP config before starting MCP/,
      )
    }))

  it('surfaces invalid Pi agent settings without treating the adapter as disabled silently', () =>
    withFixture(async ({ home, agentDir, project }) => {
      const service = createPiMcpConfigServiceForTests({ homeDir: home, agentDir })
      await writeText(path.join(agentDir, 'settings.json'), '{ "packages": ')

      const view = await service.getView(project)

      expect(view.adapter.enabled).toBe(false)
      expect(view.adapter.lastError).toMatch(/Invalid Pi settings JSON/)
      await expect(service.setAdapterEnabled(true, project)).rejects.toThrow(
        /Invalid Pi settings JSON/,
      )
    }))
})
