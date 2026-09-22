import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createFilesystemMcpConfigServiceForTests } from '../filesystem-mcp-config-service'

const fixtureRoots: string[] = []

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-native-mcp-management-'))
  fixtureRoots.push(root)
  const projectPath = path.join(root, 'project')
  await mkdir(projectPath, { recursive: true })
  let nextId = 0
  const service = createFilesystemMcpConfigServiceForTests({
    homeDir: root,
    createId: () => `mcp-management-id-${String(++nextId)}`,
  })
  return { root, projectPath, service }
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('first-party MCP configuration management', () => {
  it('adds canonical servers as disabled and untrusted management drafts', async () => {
    const { projectPath, service } = await createFixture()

    const view = await service.addServer({
      name: 'docs',
      target: 'project',
      projectPath,
      definition: { url: 'https://developers.openai.com/mcp' },
    })

    expect(view.servers).toHaveLength(1)
    expect(view.servers[0]).toMatchObject({
      name: 'docs',
      enabled: false,
      trusted: 'untrusted',
      transport: 'streamable-http',
    })
    const stored = JSON.parse(
      await readFile(path.join(projectPath, '.openwaggle', 'mcp.json'), 'utf8'),
    )
    expect(stored.mcpServers.docs).toMatchObject({
      url: 'https://developers.openai.com/mcp',
      provenance: { source: 'manual' },
    })
  })

  it('previews imports without copying credentials, then applies a reviewed fingerprint', async () => {
    const { root, projectPath, service } = await createFixture()
    const codexConfigPath = path.join(root, '.codex', 'config.toml')
    await mkdir(path.dirname(codexConfigPath), { recursive: true })
    await writeFile(
      codexConfigPath,
      [
        '[mcp_servers.docs]',
        'url = "https://developers.openai.com/mcp"',
        '[mcp_servers.docs.http_headers]',
        'Authorization = "Bearer plaintext-must-not-copy"',
      ].join('\n'),
      'utf8',
    )

    const preview = await service.previewImports({ projectPath, sources: ['codex'] })

    expect(preview.candidates).toHaveLength(1)
    expect(preview.candidates[0]).toMatchObject({
      source: 'codex',
      name: 'docs',
      definition: {
        url: 'https://developers.openai.com/mcp',
        headers: { Authorization: { secret: 'DOCS_AUTHORIZATION' } },
      },
    })
    expect(preview.candidates[0]?.warnings.join(' ')).toContain('value was not imported')
    expect(JSON.stringify(preview)).not.toContain('plaintext-must-not-copy')

    const fingerprint = preview.candidates[0]?.fingerprint ?? ''
    const result = await service.applyImports({
      projectPath,
      sources: ['codex'],
      fingerprints: [fingerprint],
      target: 'project',
      conflictPolicy: 'skip',
    })

    expect(result.imported).toEqual([
      expect.objectContaining({ source: 'codex', sourceName: 'docs', targetName: 'docs' }),
    ])
    expect(result.view.servers[0]).toMatchObject({
      name: 'docs',
      // ADR-0035: applying an import enables and trusts it in one action.
      enabled: true,
      trusted: 'trusted',
    })
    const stored = await readFile(path.join(projectPath, '.openwaggle', 'mcp.json'), 'utf8')
    expect(stored).toContain('DOCS_AUTHORIZATION')
    expect(stored).not.toContain('plaintext-must-not-copy')
  })

  it('normalizes OpenCode command arrays and previews Pi files independently', async () => {
    const { root, projectPath, service } = await createFixture()
    await writeJson(path.join(root, '.config', 'opencode', 'opencode.json'), {
      mcp: {
        search: {
          type: 'local',
          command: ['npx', '-y', '@example/search-mcp'],
          environment: { LOG_LEVEL: 'info', API_TOKEN: `$${'{'}SEARCH_TOKEN}` },
        },
      },
    })
    await writeJson(path.join(projectPath, '.pi', 'mcp.json'), {
      mcpServers: { browser: { command: 'browser-mcp', disabled: true } },
    })

    const preview = await service.previewImports({ projectPath, sources: ['opencode', 'pi'] })

    expect(preview.candidates.find((candidate) => candidate.source === 'opencode')).toMatchObject({
      name: 'search',
      definition: {
        command: 'npx',
        args: ['-y', '@example/search-mcp'],
        env: { LOG_LEVEL: 'info', API_TOKEN: { secret: 'SEARCH_TOKEN' } },
      },
    })
    expect(preview.candidates.find((candidate) => candidate.source === 'pi')).toMatchObject({
      name: 'browser',
      definition: { command: 'browser-mcp' },
    })
  })

  it('keeps secret references out of the shared .mcp.json but allows them in the OpenWaggle project config', async () => {
    const { projectPath, service } = await createFixture()
    const rawWithSecret = JSON.stringify(
      {
        mcpServers: {
          figma: {
            command: 'npx',
            args: ['-y', 'figma-developer-mcp', '--stdio'],
            env: { FIGMA_API_KEY: { secret: 'FIGMA_API_KEY' } },
          },
        },
      },
      null,
      2,
    )

    // Shared standard file (read by other MCP tools) rejects secret objects.
    await expect(
      service.writeSourceConfig({
        projectPath,
        sourceId: 'project-standard',
        rawJson: rawWithSecret,
      }),
    ).rejects.toThrow(/Secret references cannot be saved/)
    await expect(readFile(path.join(projectPath, '.mcp.json'), 'utf8')).rejects.toThrow()

    // The OpenWaggle-only project config accepts the same secret reference.
    const view = await service.writeSourceConfig({
      projectPath,
      sourceId: 'project-openwaggle',
      rawJson: rawWithSecret,
    })
    expect(view.servers.some((server) => server.name === 'figma')).toBe(true)
    const stored = JSON.parse(
      await readFile(path.join(projectPath, '.openwaggle', 'mcp.json'), 'utf8'),
    )
    expect(stored.mcpServers.figma.env.FIGMA_API_KEY).toEqual({ secret: 'FIGMA_API_KEY' })
  })

  it('derives network and package-cache grants for package-runner servers', async () => {
    const { projectPath, service } = await createFixture()
    await writeJson(path.join(projectPath, '.mcp.json'), {
      mcpServers: {
        browser: { command: 'npx', args: ['@playwright/mcp@latest'] },
        remote: { url: 'https://mcp.example.com/mcp' },
        local: { command: 'docs-mcp' },
      },
    })
    await service.setScopeState({ scope: 'project', state: 'on', projectPath })
    const view = await service.getView({ projectPath })
    const byName = new Map(view.servers.map((server) => [server.name, server]))

    const browser = byName.get('browser')
    expect(browser?.requestedPermissions.allowNetwork).toBe(true)
    expect(browser?.requestedPermissions.readRoots.join(',')).toContain('.npm')
    expect(browser?.requestedPermissions.writeRoots.join(',')).toContain('.npm')

    expect(byName.get('remote')?.requestedPermissions.allowNetwork).toBe(true)
    expect(byName.get('local')?.requestedPermissions).toMatchObject({
      allowNetwork: false,
    })
  })

  it('installs a catalog server in one step: definition, enable, trust, activation', async () => {
    const { projectPath, service } = await createFixture()

    const view = await service.installCatalogServer({ name: 'playwright', projectPath })

    const installed = view.servers.find((server) => server.name === 'playwright')
    expect(installed).toMatchObject({
      enabled: true,
      trusted: 'trusted',
      sourceId: 'global-openwaggle',
    })
    expect(view.integration.desired.effective).toBe('on')
    const stored = JSON.parse(
      await readFile(path.join(projectPath, '..', '.openwaggle', 'mcp.json'), 'utf8'),
    )
    expect(stored.mcpServers.playwright.provenance.source).toBe('catalog')

    // Installing twice keeps a single definition.
    const again = await service.installCatalogServer({ name: 'playwright', projectPath })
    expect(again.servers.filter((server) => server.name === 'playwright')).toHaveLength(1)

    const snapshot = await service.createTurnSnapshot({ projectPath, sessionId: 's-cat' })
    expect(snapshot?.servers.map((server) => server.name)).toEqual(['playwright'])
  })
})
