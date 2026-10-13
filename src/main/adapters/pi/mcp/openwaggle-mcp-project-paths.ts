/** The projects OpenWaggle knows, for the MCP migration: from settings and Sessions. */

/** Session workspace roots, paged as `WorkspaceProjectAuthorization` reads them. */
async function sessionWorkspaceRoots() {
  const { listSessionWorkspaceRootPage } = await import(
    '../../../store/session-details/workspace-root-authorization'
  )
  const roots: string[] = []
  let afterRoot: string | undefined
  while (true) {
    const page = await listSessionWorkspaceRootPage(afterRoot)
    roots.push(...page)
    const last = page.at(-1)
    if (last === undefined || last === afterRoot) return roots
    afterRoot = last
  }
}

async function settingsProjectPaths() {
  const { getSettings } = await import('../../../store/settings')
  const settings = getSettings()
  return [
    ...(settings.projectPath ? [settings.projectPath] : []),
    ...settings.recentProjects,
    ...Object.keys(settings.projectDisplayNames),
  ]
}

/**
 * The projects OpenWaggle knows, so the first run keeps their servers' old on/off state: the
 * same sources as workspace authorization, settings plus every Session's workspace root.
 */
export async function knownMcpProjectPaths(): Promise<readonly string[]> {
  return [...new Set([...(await settingsProjectPaths()), ...(await sessionWorkspaceRoots())])]
}

/**
 * The project roots whose files the migration writes: settings plus every Session's project
 * path. A managed worktree is not one; writing its `.openwaggle/mcp.json` would leave an
 * untracked file in the user's checkout.
 */
export async function durableMcpProjectPaths(): Promise<readonly string[]> {
  const { listSessionProjectRoots } = await import(
    '../../../store/session-details/workspace-root-authorization'
  )
  return [...new Set([...(await settingsProjectPaths()), ...(await listSessionProjectRoots())])]
}
