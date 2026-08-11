import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  beginMcpTurn,
  clearMcpTurnApplications,
  completeMcpTurn,
} from '../../../domain/mcp/turn-application-state'
import { createFilesystemMcpConfigServiceForTests } from '../filesystem-mcp-config-service'

const fixtureRoots: string[] = []

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-native-mcp-'))
  fixtureRoots.push(root)
  const projectPath = path.join(root, 'project')
  await mkdir(projectPath, { recursive: true })
  let nextId = 0
  const service = createFilesystemMcpConfigServiceForTests({
    homeDir: root,
    createId: () => `mcp-id-${String(++nextId)}`,
  })
  return {
    root,
    projectPath,
    service,
    createPeerService: () =>
      createFilesystemMcpConfigServiceForTests({
        homeDir: root,
        createId: () => `mcp-id-${String(++nextId)}`,
      }),
  }
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

afterEach(async () => {
  clearMcpTurnApplications()
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('first-party MCP configuration', () => {
  it('is globally off by default and has no adapter state', async () => {
    const { projectPath, service } = await createFixture()

    const view = await service.getView({ projectPath, sessionId: 'session-1' })

    expect(view.integration.desired).toEqual({
      global: 'off',
      project: 'inherit',
      session: 'inherit',
      effective: 'off',
      source: 'global',
    })
    expect(view.integration.applied).toBe('off')
    expect(view.sources.map((source) => source.id)).toEqual([
      'global-openwaggle',
      'project-standard',
      'project-openwaggle',
    ])
    expect(Object.hasOwn(view, 'adapter')).toBe(false)
  })

  it('requires explicit scope enablement, local enablement, and hash-bound trust', async () => {
    const { projectPath, service } = await createFixture()
    await writeJson(path.join(projectPath, '.mcp.json'), {
      mcpServers: {
        docs: { command: 'docs-mcp', args: ['--stdio'] },
      },
    })

    let view = await service.getView({ projectPath, sessionId: 'session-1' })
    const server = view.servers[0]
    expect(server?.enabled).toBe(false)
    expect(server?.trusted).toBe('untrusted')
    expect(server?.connectionState).toBe('blocked')
    expect(await service.createTurnSnapshot({ projectPath, sessionId: 'session-1' })).toBeNull()

    view = await service.setScopeState({
      scope: 'project',
      state: 'on',
      projectPath,
      sessionId: 'session-1',
    })
    expect(view.integration.desired.effective).toBe('on')
    await service.setServerEnabled({
      instanceId: server?.instanceId ?? '',
      enabled: true,
      projectPath,
      sessionId: 'session-1',
    })
    view = await service.setServerTrust({
      instanceId: server?.instanceId ?? '',
      trusted: true,
      permissions: { readRoots: ['.'], writeRoots: [], allowNetwork: false },
      projectPath,
      sessionId: 'session-1',
    })

    expect(view.servers[0]?.trusted).toBe('trusted')
    const snapshot = await service.createTurnSnapshot({ projectPath, sessionId: 'session-1' })
    expect(snapshot?.servers).toHaveLength(1)
    expect(snapshot?.servers[0]?.definition).toMatchObject({
      command: 'docs-mcp',
      args: ['--stdio'],
    })
  })

  it('keeps logical project identity while executing inside a session worktree', async () => {
    const { root, projectPath, service } = await createFixture()
    const executionPath = path.join(root, 'session-worktree')
    await mkdir(executionPath, { recursive: true })
    await writeJson(path.join(projectPath, '.mcp.json'), {
      mcpServers: { docs: { command: 'docs-mcp' } },
    })
    const initial = await service.getView({ projectPath, sessionId: 'session-worktree' })
    const instanceId = initial.servers[0]?.instanceId ?? ''
    await service.setScopeState({ scope: 'project', state: 'on', projectPath })
    await service.setServerEnabled({ instanceId, enabled: true, projectPath })
    await service.setServerTrust({
      instanceId,
      trusted: true,
      permissions: { readRoots: ['.'], writeRoots: [], allowNetwork: false },
      projectPath,
    })

    const snapshot = await service.createTurnSnapshot({
      projectPath,
      executionPath,
      sessionId: 'session-worktree',
    })

    expect(snapshot).toMatchObject({ projectPath, executionPath })
    expect(snapshot?.servers[0]).toMatchObject({
      instanceId,
      sourcePath: path.join(projectPath, '.mcp.json'),
    })
  })

  it('invalidates trust when the executable configuration changes', async () => {
    const { projectPath, service } = await createFixture()
    const configPath = path.join(projectPath, '.mcp.json')
    await writeJson(configPath, { mcpServers: { docs: { command: 'docs-mcp' } } })
    let view = await service.getView({ projectPath })
    const instanceId = view.servers[0]?.instanceId ?? ''
    await service.setServerTrust({
      instanceId,
      trusted: true,
      permissions: { readRoots: ['.'], writeRoots: [], allowNetwork: false },
      projectPath,
    })

    await writeJson(configPath, {
      mcpServers: { docs: { command: 'different-mcp', args: ['--changed'] } },
    })
    view = await service.getView({ projectPath })

    expect(view.servers[0]?.instanceId).toBe(instanceId)
    expect(view.servers[0]?.trusted).toBe('invalidated')
    expect(view.servers[0]?.blockedReason).toContain('configuration changed')
  })

  it('serializes concurrent user-state mutations without dropping either server update', async () => {
    const { projectPath, service, createPeerService } = await createFixture()
    await writeJson(path.join(projectPath, '.mcp.json'), {
      mcpServers: {
        first: { command: 'first-mcp' },
        second: { command: 'second-mcp' },
      },
    })
    const initial = await service.getView({ projectPath })
    const [first, second] = initial.servers
    if (!first || !second) throw new Error('Expected two MCP fixtures.')

    await Promise.all([
      service.setServerEnabled({ projectPath, instanceId: first.instanceId, enabled: true }),
      createPeerService().setServerEnabled({
        projectPath,
        instanceId: second.instanceId,
        enabled: true,
      }),
    ])

    const updated = await service.getView({ projectPath })
    expect(updated.servers).toEqual([
      expect.objectContaining({ name: 'first', enabled: true }),
      expect.objectContaining({ name: 'second', enabled: true }),
    ])
  })

  it('resolves session then project then global without changing active snapshots', async () => {
    const { projectPath, service } = await createFixture()
    await service.setScopeState({ scope: 'global', state: 'on' })
    await service.setScopeState({ scope: 'project', state: 'off', projectPath })
    let view = await service.getView({ projectPath, sessionId: 'session-1' })
    expect(view.integration.desired).toMatchObject({ effective: 'off', source: 'project' })

    await service.setScopeState({
      scope: 'session',
      state: 'on',
      projectPath,
      sessionId: 'session-1',
    })
    view = await service.getView({ projectPath, sessionId: 'session-1' })
    expect(view.integration.desired).toMatchObject({ effective: 'on', source: 'session' })

    await service.setScopeState({
      scope: 'session',
      state: 'inherit',
      projectPath,
      sessionId: 'session-1',
    })
    view = await service.getView({ projectPath, sessionId: 'session-1' })
    expect(view.integration.desired).toMatchObject({ effective: 'off', source: 'project' })
  })

  it('reports desired and applied state separately until the active turn settles', async () => {
    const { projectPath, service } = await createFixture()
    await service.setScopeState({ scope: 'project', state: 'on', projectPath })
    const turn = await service.createTurnSnapshot({ projectPath, sessionId: 'session-pending' })
    expect(turn).not.toBeNull()
    beginMcpTurn('session-pending', turn?.revision ?? null)

    const pending = await service.setScopeState({
      scope: 'session',
      state: 'off',
      projectPath,
      sessionId: 'session-pending',
    })

    expect(pending.integration).toMatchObject({
      desired: { effective: 'off' },
      applied: 'on',
      applyState: 'pending',
    })
    expect(pending.integration.pendingReason).toContain('active turn')

    completeMcpTurn('session-pending')
    const applied = await service.getView({ projectPath, sessionId: 'session-pending' })
    expect(applied.integration).toMatchObject({ applied: 'off', applyState: 'applied' })
  })

  it('preserves unknown fields but reports that they are ignored', async () => {
    const { projectPath, service } = await createFixture()
    const configPath = path.join(projectPath, '.mcp.json')
    await writeJson(configPath, {
      futureTopLevel: { enabled: true },
      mcpServers: {
        docs: { command: 'docs-mcp', futureTransportOption: 'value' },
      },
    })

    const view = await service.getView({ projectPath })
    expect(view.sources.find((source) => source.id === 'project-standard')?.ignoredFields).toEqual([
      'docs.futureTransportOption',
      'futureTopLevel',
    ])

    const raw = await readFile(configPath, 'utf-8')
    expect(raw).toContain('futureTransportOption')
  })

  it('blocks plaintext secret-like values and accepts secret references', async () => {
    const { projectPath, service } = await createFixture()
    const configPath = path.join(projectPath, '.mcp.json')
    await writeJson(configPath, {
      mcpServers: {
        unsafe: { command: 'unsafe-mcp', env: { API_TOKEN: 'plaintext' } },
        safe: { command: 'safe-mcp', env: { API_TOKEN: { secret: 'docs-token' } } },
      },
    })

    const view = await service.getView({ projectPath })
    expect(view.servers.find((server) => server.name === 'unsafe')?.blockedReason).toContain(
      'Plaintext',
    )
    expect(view.servers.find((server) => server.name === 'safe')?.blockedReason).toBe(
      'Server is disabled.',
    )
  })
})
