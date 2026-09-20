import fs from 'node:fs/promises'

/** A project may be opened through a symlink (for example /var -> /private/var on macOS). */
export async function agentDefinitionTogglesForProject(
  togglesByProject: Readonly<Record<string, Readonly<Record<string, boolean>>>>,
  projectPath: string,
): Promise<Readonly<Record<string, boolean>>> {
  if (Object.keys(togglesByProject).length === 0) return {}
  const canonicalPath = await fs.realpath(projectPath).catch(() => projectPath)
  return togglesByProject[canonicalPath] ?? togglesByProject[projectPath] ?? {}
}
