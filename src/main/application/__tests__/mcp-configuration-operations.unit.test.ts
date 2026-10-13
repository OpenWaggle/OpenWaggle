import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addMcpServerOperation,
  getMcpConfigurationOperation,
  installMcpCatalogServerOperation,
  removeMcpServerOperation,
  setMcpServerEnabledOperation,
  setMcpServerExposureOperation,
} from '../mcp-configuration-operations'
import { createMcpOperationsHarness } from './mcp-configuration-operations.test-harness'

const harness = createMcpOperationsHarness()
const { run, failureMessage, writeJson, servers, piGlobal, owGlobal, owProject } = harness

describe('MCP configuration operations', () => {
  it('lists servers from Pi and OpenWaggle files with the file that defines each', async () => {
    writeJson(piGlobal(), { mcpServers: { docs: { url: 'https://docs.example/mcp' } } })
    writeJson(owGlobal(), { mcpServers: { tools: { command: 'npx', args: ['tools-mcp'] } } })

    const view = await run(getMcpConfigurationOperation({ projectPath: null }))

    expect(view.servers.map((server) => [server.name, server.source.fileId])).toEqual([
      ['docs', 'pi-global'],
      ['tools', 'openwaggle-global'],
    ])
    expect(view.servers.find((server) => server.name === 'docs')?.usesOAuth).toBe(true)
  })

  it("adds a new server to OpenWaggle's file for its scope unless another file is picked", async () => {
    await run(
      addMcpServerOperation({
        projectPath: harness.state.projectPath,
        name: 'global-tools',
        scope: 'global',
        entry: { command: 'npx', args: ['tools-mcp'] },
      }),
    )
    await run(
      addMcpServerOperation({
        projectPath: harness.state.projectPath,
        name: 'project-tools',
        scope: 'project',
        entry: { command: 'uvx', args: ['project-mcp'] },
      }),
    )
    const view = await run(
      addMcpServerOperation({
        projectPath: harness.state.projectPath,
        name: 'pi-tools',
        scope: 'global',
        destination: 'pi-global',
        entry: { url: 'https://pi.example/mcp' },
      }),
    )

    expect(Object.keys(servers(owGlobal()))).toEqual(['global-tools'])
    expect(Object.keys(servers(owProject()))).toEqual(['project-tools'])
    expect(Object.keys(servers(piGlobal()))).toEqual(['pi-tools'])
    expect(view.servers.map((server) => server.name).sort()).toEqual([
      'global-tools',
      'pi-tools',
      'project-tools',
    ])
  })

  it('keeps every Pi entry field the schema does not list', async () => {
    await run(
      addMcpServerOperation({
        projectPath: null,
        name: 'sentry',
        scope: 'global',
        entry: {
          url: 'https://mcp.sentry.dev/mcp',
          timeout: 30,
          oauth: { clientName: 'Example Client', callbackPort: 8765 },
        },
      }),
    )

    expect(servers(owGlobal()).sentry).toEqual({
      url: 'https://mcp.sentry.dev/mcp',
      timeout: 30,
      oauth: { clientName: 'Example Client', callbackPort: 8765 },
    })
  })

  it("allows vault secret references only in OpenWaggle's files", async () => {
    const entry = { command: 'npx', env: { API_KEY: { secret: 'tools-key' } } }

    await run(addMcpServerOperation({ projectPath: null, name: 'vaulted', scope: 'global', entry }))
    const message = await failureMessage(
      addMcpServerOperation({
        projectPath: null,
        name: 'leaked',
        scope: 'global',
        destination: 'pi-global',
        entry,
      }),
    )

    expect(servers(owGlobal()).vaulted).toEqual(entry)
    expect(message).toMatch(/secret/i)
  })

  it('switches a global server for one project with an override in the project file', async () => {
    writeJson(piGlobal(), { mcpServers: { docs: { url: 'https://docs.example/mcp' } } })

    const view = await run(
      setMcpServerEnabledOperation({
        projectPath: harness.state.projectPath,
        name: 'docs',
        enabled: false,
        target: 'project',
      }),
    )

    expect(servers(owProject()).docs).toEqual({ enabled: false })
    expect(servers(piGlobal()).docs).toEqual({ url: 'https://docs.example/mcp' })
    expect(view.servers[0]).toMatchObject({
      enabled: false,
      override: { fileId: 'project-openwaggle' },
    })
  })

  it('refuses a per-project switch without a project', async () => {
    writeJson(piGlobal(), { mcpServers: { docs: { url: 'https://docs.example/mcp' } } })

    await expect(
      failureMessage(
        setMcpServerEnabledOperation({
          projectPath: null,
          name: 'docs',
          enabled: false,
          target: 'project',
        }),
      ),
    ).resolves.toMatch(/Choose a project/)
  })

  it('refuses a project OpenWaggle does not know and writes nothing there', async () => {
    const unknownProject = `${harness.state.projectPath}-elsewhere`

    await expect(
      failureMessage(
        addMcpServerOperation({
          projectPath: unknownProject,
          name: 'planted',
          scope: 'project',
          entry: { command: 'touch', args: ['planted'] },
        }),
      ),
    ).resolves.toBe('Open this project in OpenWaggle before changing its MCP servers.')
    // A read, such as `openwaggle mcp doctor -l`, changes nothing, and says so.
    await expect(
      failureMessage(getMcpConfigurationOperation({ projectPath: unknownProject })),
    ).resolves.toBe('Open this project in OpenWaggle before checking its MCP servers.')
  })

  it('saves server and per-tool exposure where the server is defined', async () => {
    writeJson(owGlobal(), { mcpServers: { github: { url: 'https://github.example/mcp' } } })

    await run(
      setMcpServerExposureOperation({
        projectPath: null,
        name: 'github',
        exposure: 'deferred',
        toolExposure: { search_code: 'direct', 'delete_*': 'hidden' },
      }),
    )
    const view = await run(
      setMcpServerExposureOperation({
        projectPath: null,
        name: 'github',
        toolExposure: { 'delete_*': null },
      }),
    )

    expect(servers(owGlobal()).github).toEqual({
      url: 'https://github.example/mcp',
      exposure: 'deferred',
      toolExposure: { search_code: 'direct' },
    })
    expect(view.servers[0]).toMatchObject({
      exposure: 'deferred',
      toolExposure: { search_code: 'direct' },
    })
  })

  it('rejects an exposure change that sets nothing or names an unknown exposure', async () => {
    writeJson(owGlobal(), { mcpServers: { github: { url: 'https://github.example/mcp' } } })

    await expect(
      failureMessage(setMcpServerExposureOperation({ projectPath: null, name: 'github' })),
    ).resolves.toMatch(/exposure/)
    await expect(
      failureMessage(
        setMcpServerExposureOperation({ projectPath: null, name: 'github', exposure: 'always' }),
      ),
    ).resolves.toMatch(/exposure/)
  })

  it('removes a server from the file that defines it', async () => {
    writeJson(owGlobal(), {
      mcpServers: { docs: { url: 'https://docs.example/mcp' }, keep: { command: 'keep' } },
    })

    const view = await run(removeMcpServerOperation({ projectPath: null, name: 'docs' }))

    expect(Object.keys(servers(owGlobal()))).toEqual(['keep'])
    expect(view.servers.map((server) => server.name)).toEqual(['keep'])
  })

  it('removes only an orphaned override when the request names its file', async () => {
    writeJson(owGlobal(), { mcpServers: { gone: { enabled: false }, keep: { command: 'keep' } } })

    const view = await run(
      removeMcpServerOperation({
        projectPath: null,
        name: 'gone',
        orphanedOverride: { fileId: 'openwaggle-global' },
      }),
    )
    const refused = await failureMessage(
      removeMcpServerOperation({
        projectPath: null,
        name: 'keep',
        orphanedOverride: { fileId: 'openwaggle-global' },
      }),
    )

    expect(servers(owGlobal())).toEqual({ keep: { command: 'keep' } })
    expect(view.orphanedOverrides ?? []).toEqual([])
    expect(refused).toMatch(/no orphaned override/)
  })

  it('installs a catalog server as an ordinary entry', async () => {
    const view = await run(
      installMcpCatalogServerOperation({
        projectPath: null,
        catalogName: 'playwright',
        scope: 'global',
      }),
    )

    expect(servers(owGlobal()).playwright).toEqual({
      command: 'npx',
      args: ['@playwright/mcp@latest'],
    })
    expect(view.servers.map((server) => server.name)).toEqual(['playwright'])
    await expect(
      failureMessage(
        installMcpCatalogServerOperation({
          projectPath: null,
          catalogName: 'unknown',
          scope: 'global',
        }),
      ),
    ).resolves.toMatch(/No catalog server/)
  })

  it("writes and reads a worktree's project servers in the project, where Runs read them", async () => {
    writeJson(owProject(), { mcpServers: { existing: { command: 'npx', args: ['existing'] } } })

    const listed = await run(
      getMcpConfigurationOperation({ projectPath: harness.state.worktreePath }),
    )
    await run(
      addMcpServerOperation({
        projectPath: harness.state.worktreePath,
        name: 'from-worktree',
        scope: 'project',
        entry: { command: 'uvx', args: ['worktree-mcp'] },
      }),
    )

    expect(listed.servers.map((server) => server.name)).toEqual(['existing'])
    expect(Object.keys(servers(owProject()))).toEqual(['existing', 'from-worktree'])
    expect(existsSync(path.join(harness.state.worktreePath, '.openwaggle', 'mcp.json'))).toBe(false)
  })
})
