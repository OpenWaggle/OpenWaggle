import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { oldIdentityKey } from '../../../mcp/migration/__tests__/migration-fixtures'

const run = promisify(execFile)

/** The QA install: a project, and a Session in a managed worktree of it (as OpenWaggle makes one). */
const home = realpathSync(homedir())
const project = path.join(home, 'projects', 'demo')
const worktree = path.join(home, '.openwaggle', 'worktrees', 'demo', 'session-1')

// The shared setup gives this file a temporary HOME; the real migration runs against it here.
vi.unmock('../openwaggle-mcp-migration')
vi.mock('../../../../store/settings', () => ({
  getSettings: () => ({ projectPath: project, recentProjects: [], projectDisplayNames: {} }),
}))
// The Session's project root, and its managed worktree among the workspace roots.
vi.mock('../../../../store/session-details/workspace-root-authorization', () => ({
  listSessionProjectRoots: async () => [project],
  listSessionWorkspaceRootPage: async (afterRoot?: string) =>
    afterRoot === undefined ? [project, worktree] : [],
}))
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', () => ({
  resolveMcpVaultSecret: async () => {
    throw new Error('no vault in this test')
  },
}))

const { migrateOpenWaggleMcpFilesAtHostStart } = await import('../openwaggle-mcp-migration')
const { pruneSessionWorktree } = await import('../../../../services/git/session-worktree-prune')

async function git(cwd: string, ...args: string[]) {
  await run('git', ['-c', 'user.email=qa@example.com', '-c', 'user.name=QA', ...args], { cwd })
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value))
}

describe('the MCP migration at Host start and managed worktrees', () => {
  it('leaves a Session worktree clean, so the Session can still be deleted', async () => {
    mkdirSync(project, { recursive: true })
    await git(project, 'init', '-q', '-b', 'main')
    // The project's own .mcp.json, which the worktree checks out too.
    writeJson(path.join(project, '.mcp.json'), { mcpServers: { projsrv: { command: 'projsrv' } } })
    await git(project, 'add', '.')
    await git(project, 'commit', '-q', '-m', 'init')
    mkdirSync(path.dirname(worktree), { recursive: true })
    await git(project, 'worktree', 'add', '-q', '-b', 'ow/session-1', worktree)
    // The old OpenWaggle had MCP on, and kept projsrv off for the project and its worktree.
    writeJson(path.join(home, '.openwaggle', 'mcp.json'), { mcpServers: {} })
    writeJson(path.join(home, '.openwaggle', 'mcp', 'state.json'), {
      version: 1,
      globalState: 'on',
      projectStates: { [project]: 'on', [worktree]: 'on' },
      sessionStates: {},
      projectServerStates: {},
      servers: {
        [oldIdentityKey(path.join(project, '.mcp.json'), 'projsrv')]: {
          instanceId: 'projsrv-1',
          enabled: false,
        },
        [oldIdentityKey(path.join(worktree, '.mcp.json'), 'projsrv')]: {
          instanceId: 'projsrv-2',
          enabled: false,
        },
      },
    })

    await migrateOpenWaggleMcpFilesAtHostStart()

    // The project keeps projsrv off in its own file; the worktree gets nothing.
    expect(existsSync(path.join(project, '.openwaggle', 'mcp.json'))).toBe(true)
    expect(existsSync(path.join(worktree, '.openwaggle', 'mcp.json'))).toBe(false)
    const deletion = await pruneSessionWorktree(
      {
        sessionId: 'session-1',
        projectPath: project,
        worktreePath: worktree,
        reason: 'delete',
        validateOnly: true,
      },
      {
        listWorktreeRefs: async () => [{ sessionId: 'session-1', worktreePath: worktree }],
        clearWorktree: async () => {},
      },
    )
    expect(deletion).toEqual({ status: 'ready-for-deletion' })
  })
})
