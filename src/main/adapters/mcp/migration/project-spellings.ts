/**
 * One project can be reached by several spellings of its path: a symbolic link such as /tmp to
 * /private/tmp, or a Settings path next to a Session's. The migration handles each real folder
 * once, under the spelling the old OpenWaggle used for it, since state.json keys its switches by
 * that spelling (`path.resolve` of the path it was given, never the real path).
 */
import { isRecord } from '@shared/utils/validation'
import { realLocation } from '../config/mcp-config-files'
import type { McpFileSources } from './file-computation'
import { legacyServerIdentityKey } from './legacy-pi-import'
import {
  type LegacyStateFile,
  legacyServerMap,
  legacyStateProjects,
  normalizeLegacyProjectPath,
} from './legacy-state'
import { isInside, managedWorktreesRoot, projectMcpPaths } from './migration-paths'

/** Whether two spellings reach the same file or folder. */
export function sameMigrationLocation(left: string, right: string) {
  return left === right || realLocation(left) === realLocation(right)
}

/** How many of the spelling's old servers state.json has switches for under that spelling. */
async function stateHits(sources: McpFileSources, state: LegacyStateFile, projectPath: string) {
  const project = projectMcpPaths(projectPath)
  let hits = 0
  for (const filePath of [project.openwaggle, project.mcpJson]) {
    const config = await sources.legacyConfig(filePath).catch(() => undefined)
    if (!isRecord(config)) continue
    for (const name of Object.keys(legacyServerMap(config))) {
      if (state.servers[legacyServerIdentityKey(filePath, name)]) hits += 1
    }
  }
  return hits
}

/** The spelling the old OpenWaggle used: the one state.json names, else the one its keys use. */
async function oldSpelling(
  spellings: readonly string[],
  input: { readonly sources: McpFileSources; readonly state: LegacyStateFile },
) {
  const [first] = spellings
  if (first === undefined || spellings.length === 1) return first
  const named = new Set(legacyStateProjects(input.state))
  const inState = spellings.find((spelling) => named.has(spelling))
  if (inState !== undefined) return inState
  let best = first
  let bestHits = 0
  for (const spelling of spellings) {
    const hits = await stateHits(input.sources, input.state, spelling)
    if (hits > bestHits) {
      best = spelling
      bestHits = hits
    }
  }
  return best
}

/** One spelling per real folder, in first-seen order. */
async function oneSpellingPerProject(
  projects: readonly string[],
  input: { readonly sources: McpFileSources; readonly state: LegacyStateFile },
) {
  const byFolder = new Map<string, string[]>()
  for (const projectPath of projects) {
    const folder = realLocation(projectPath)
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), projectPath])
  }
  const chosen: string[] = []
  for (const spellings of byFolder.values()) {
    const spelling = await oldSpelling(spellings, input)
    if (spelling !== undefined) chosen.push(spelling)
  }
  return chosen
}

/**
 * The projects whose files are migrated. A managed worktree (`~/.openwaggle/worktrees/…`) is never
 * one, even when the old state names it: a new `.openwaggle/mcp.json` there would be an untracked
 * file in the Session's checkout, and Git would then refuse to remove it when the Session is deleted.
 */
export async function migrationProjects(input: {
  readonly homeDir: string
  readonly projectPaths: readonly string[]
  readonly state: LegacyStateFile
  readonly sources: McpFileSources
  readonly knownProjectPaths: () => Promise<readonly string[]>
  /** The projects the first run recorded (`legacyProjects`), under the spellings it saw. */
  readonly recordedProjects: readonly string[]
}) {
  const { state, sources } = input
  const worktrees = managedWorktreesRoot(input.homeDir)
  // Other spellings of a folder help find the one the old state used for it.
  const known = await input.knownProjectPaths()
  const projects = [
    ...input.projectPaths,
    ...legacyStateProjects(state),
    ...known,
    ...input.recordedProjects,
  ]
    .filter((projectPath) => projectPath.trim().length > 0)
    .map(normalizeLegacyProjectPath)
    .filter((projectPath) => !isInside(projectPath, worktrees))
  const wanted = [...input.projectPaths, ...legacyStateProjects(state)].map(
    normalizeLegacyProjectPath,
  )
  const spellings = await oneSpellingPerProject([...new Set(projects)], { sources, state })
  // Only the projects asked for or named by the old state; a known one only lends its spelling.
  return spellings.filter((spelling) =>
    wanted.some((projectPath) => sameMigrationLocation(projectPath, spelling)),
  )
}

/** Whether the old on/off state is kept for the project, by its real folder. */
export function keepsEnablement(kept: readonly string[] | null, projectPath: string) {
  return kept?.some((candidate) => sameMigrationLocation(candidate, projectPath)) === true
}
