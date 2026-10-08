import { describe, expect, it, vi } from 'vitest'

const migrate = vi.hoisted(() =>
  vi.fn(async (_input: { readonly projectPaths: readonly string[] }) => ({
    files: [],
    oauth: [],
    droppedSessionStates: 0,
  })),
)

vi.unmock('../openwaggle-mcp-migration')
vi.mock('../../../mcp/migration/migrate-openwaggle-mcp-files', () => ({
  migrateOpenWaggleMcpFiles: migrate,
}))
vi.mock('../../../mcp/encrypted-mcp-secret-vault-service', () => ({
  resolveMcpVaultSecret: async () => undefined,
}))
vi.mock('../../../../store/settings', () => ({
  getSettings: () => ({
    projectPath: '/work/current',
    recentProjects: ['/work/recent'],
    projectDisplayNames: { '/work/named': 'Named' },
  }),
}))
// Two pages of Session workspace roots, as WorkspaceProjectAuthorization reads them: Session
// project roots and the managed worktrees their Sessions run in.
vi.mock('../../../../store/session-details/workspace-root-authorization', () => ({
  listSessionProjectRoots: async () => ['/work/a-session-only', '/work/recent'],
  listSessionWorkspaceRootPage: async (afterRoot?: string) =>
    afterRoot === undefined
      ? ['/work/a-session-only', '/work/recent']
      : afterRoot === '/work/recent'
        ? ['/worktrees/app/session-1']
        : [],
}))

const { knownMcpProjectPaths, migrateOpenWaggleMcpFilesAtHostStart } = await import(
  '../openwaggle-mcp-migration'
)

describe('the projects whose old MCP on/off state the migration keeps', () => {
  it('include projects known only through their Sessions, like workspace authorization', async () => {
    expect([...(await knownMcpProjectPaths())].sort()).toEqual([
      '/work/a-session-only',
      '/work/current',
      '/work/named',
      '/work/recent',
      '/worktrees/app/session-1',
    ])
  })

  it('migrate files only in project roots, never in a managed worktree', async () => {
    await migrateOpenWaggleMcpFilesAtHostStart()

    const migrated = migrate.mock.calls.flatMap(([input]) => input.projectPaths)
    expect([...migrated].sort()).toEqual([
      '/work/a-session-only',
      '/work/current',
      '/work/named',
      '/work/recent',
    ])
  })
})
