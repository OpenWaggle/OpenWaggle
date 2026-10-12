import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mcpUpdateRefusal } from '../../config/mcp-write-refusal'
import { pendingKeptProjects, pendingMcpFileMigration } from '../migration-health'
import { cleanUpPendingLegacy, setUpPendingLegacy } from './pending-legacy-setup'

afterEach(cleanUpPendingLegacy)

/** A kept project whose file cannot be migrated yet, and a Run's project that keeps nothing. */
async function keptFailingProject() {
  const setUp = await setUpPendingLegacy()
  const kept = await setUp.danglingProject('kept')
  const other = path.join(setUp.root, 'other')
  await mkdir(other, { recursive: true })
  await setUp.migrate([kept])
  await setUp.migrate([other])
  // The dotfiles checkout is mounted again; nobody opens that project afterwards.
  const fix = () => mkdir(path.join(setUp.root, 'unmounted', 'kept'), { recursive: true })
  const migrateOne = async (projectPath: string | null) =>
    setUp.migrate(projectPath ? [projectPath] : [])
  return { ...setUp, kept, other, fix, migrateOne }
}

describe('a global change waiting on a kept project that was fixed since', () => {
  it("lets Pi's /mcp change through from another project's Run, with no Settings write", async () => {
    const { homeDir, piAgentDir, other, fix, migrateOne } = await keptFailingProject()
    const globalFile = path.join(homeDir, '.openwaggle', 'mcp.json')
    const refusal = mcpUpdateRefusal(
      { homeDir, piAgentDir, projectPath: other },
      { migrate: migrateOne, pendingKeptProjects: () => pendingKeptProjects(homeDir) },
    )
    expect(refusal(globalFile)).toBeDefined()

    await fix()

    // Each refusal migrates the kept project again in the background; /mcp is retried.
    await vi.waitFor(() => expect(refusal(globalFile)).toBeUndefined())
  })

  it('is no longer refused once Settings > MCP is opened again, from any scope', async () => {
    const { homeDir, fix, service } = await keptFailingProject()
    await fix()

    await Effect.runPromise(service.getView({ projectPath: null }))

    expect(pendingMcpFileMigration(homeDir, null, 'global')).toBeUndefined()
  })
})
