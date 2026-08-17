import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createInMemoryMcpTurnStateTracker } from '../../../domain/mcp/turn-application-state'
import { createFilesystemMcpConfigServiceForTests } from '../filesystem-mcp-config-service'

const fixtureRoots: string[] = []
const turnTracker = createInMemoryMcpTurnStateTracker()

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-project-servers-'))
  fixtureRoots.push(root)
  const projectPath = path.join(root, 'project')
  await mkdir(projectPath, { recursive: true })
  let nextId = 0
  const service = createFilesystemMcpConfigServiceForTests({
    homeDir: root,
    createId: () => `mcp-id-${String(++nextId)}`,
    getActiveTurn: (sessionId) => turnTracker.getActive(sessionId),
  })
  return { root, projectPath, service }
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

const TRUST = { readRoots: ['.'], writeRoots: [], allowNetwork: false }

afterEach(async () => {
  turnTracker.clear()
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('per-project MCP server overrides', () => {
  it('mutes a shared global server for one project without affecting other projects', async () => {
    const { root, projectPath, service } = await createFixture()
    const projectB = path.join(root, 'project-b')
    await mkdir(projectB, { recursive: true })
    // A server defined in the GLOBAL config is shared by every project.
    await writeJson(path.join(root, '.openwaggle', 'mcp.json'), {
      mcpServers: { shared: { command: 'shared-mcp' } },
    })
    await service.setScopeState({ scope: 'global', state: 'on' })
    const initial = await service.getView({ projectPath })
    const instanceId = initial.servers[0]?.instanceId ?? ''
    await service.setServerEnabled({ instanceId, enabled: true, projectPath })
    await service.setServerTrust({ instanceId, trusted: true, permissions: TRUST, projectPath })

    // Both projects see the shared server as enabled and would run it.
    expect((await service.getView({ projectPath })).servers[0]?.projectEnabled).toBe(true)
    expect((await service.getView({ projectPath: projectB })).servers[0]?.projectEnabled).toBe(true)
    expect(
      (await service.createTurnSnapshot({ projectPath, sessionId: 's-a' }))?.servers,
    ).toHaveLength(1)
    expect(
      (await service.createTurnSnapshot({ projectPath: projectB, sessionId: 's-b' }))?.servers,
    ).toHaveLength(1)

    // Mute it for project A only.
    const mutedView = await service.setProjectServerEnabled({
      instanceId,
      enabled: false,
      projectPath,
    })
    expect(mutedView.servers[0]?.projectEnabled).toBe(false)

    // Project A no longer runs it; project B is unaffected.
    expect(
      (await service.createTurnSnapshot({ projectPath, sessionId: 's-a' }))?.servers,
    ).toHaveLength(0)
    const viewB = await service.getView({ projectPath: projectB })
    expect(viewB.servers[0]?.projectEnabled).toBe(true)
    expect(
      (await service.createTurnSnapshot({ projectPath: projectB, sessionId: 's-b' }))?.servers,
    ).toHaveLength(1)

    // Re-enabling clears the override for A.
    const reView = await service.setProjectServerEnabled({ instanceId, enabled: true, projectPath })
    expect(reView.servers[0]?.projectEnabled).toBe(true)
    expect(
      (await service.createTurnSnapshot({ projectPath, sessionId: 's-a' }))?.servers,
    ).toHaveLength(1)
  })

  it('keeps a required server running even when muted for a project', async () => {
    const { projectPath, service } = await createFixture()
    await writeJson(path.join(projectPath, '.mcp.json'), {
      mcpServers: { must: { command: 'must-mcp', required: true } },
    })
    await service.setScopeState({ scope: 'project', state: 'on', projectPath })
    const initial = await service.getView({ projectPath })
    const instanceId = initial.servers[0]?.instanceId ?? ''
    await service.setServerEnabled({ instanceId, enabled: true, projectPath })
    await service.setServerTrust({ instanceId, trusted: true, permissions: TRUST, projectPath })

    await service.setProjectServerEnabled({ instanceId, enabled: false, projectPath })

    // Required servers bypass the per-project mute so ADR guarantees hold.
    const snapshot = await service.createTurnSnapshot({ projectPath, sessionId: 's-req' })
    expect(snapshot?.servers).toHaveLength(1)
  })
})
