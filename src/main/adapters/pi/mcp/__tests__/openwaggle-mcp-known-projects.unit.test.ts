import { describe, expect, it, vi } from 'vitest'

vi.unmock('../openwaggle-mcp-migration')
vi.mock('../../../../store/settings', () => ({
  getSettings: () => ({
    projectPath: '/work/current',
    recentProjects: ['/work/recent'],
    projectDisplayNames: { '/work/named': 'Named' },
  }),
}))
// Two pages of Session workspace roots, as WorkspaceProjectAuthorization reads them.
vi.mock('../../../../store/session-details/workspace-root-authorization', () => ({
  listSessionWorkspaceRootPage: async (afterRoot?: string) =>
    afterRoot === undefined
      ? ['/work/a-session-only', '/work/recent']
      : afterRoot === '/work/recent'
        ? ['/work/z-session-only']
        : [],
}))

const { knownMcpProjectPaths } = await import('../openwaggle-mcp-migration')

describe('the projects whose old MCP on/off state the migration keeps', () => {
  it('include projects known only through their Sessions, like workspace authorization', async () => {
    expect([...(await knownMcpProjectPaths())].sort()).toEqual([
      '/work/a-session-only',
      '/work/current',
      '/work/named',
      '/work/recent',
      '/work/z-session-only',
    ])
  })
})
