/**
 * One project can be reached by several spellings of its path: a symbolic link such as /tmp to
 * /private/tmp, or a Settings path next to a Session's. The migration handles each real folder
 * once, under the spelling the old OpenWaggle used for it, since state.json keys its switches by
 * that spelling (`path.resolve` of the path it was given, never the real path).
 */
import { settledValue } from '@shared/utils/all-in-order'
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
import type { McpMigrationFs } from './migration-fs'
import { recordMcpFileMigrationOutcome } from './migration-health'
import { isInside, managedWorktreesRoot, projectMcpPaths } from './migration-paths'

/** Whether two spellings reach the same file or folder. */
export function sameMigrationLocation(left: string, right: string) {
  return left === right || realLocation(left) === realLocation(right)
}

/** How many of the spelling's old servers state.json has switches for under that spelling. */
async function stateHits(sources: McpFileSources, state: LegacyStateFile, projectPath: string) {
  const project = projectMcpPaths(projectPath)
  const files = await Promise.all(
    [project.openwaggle, project.mcpJson].map(async (filePath) => ({
      filePath,
      config: await sources.legacyConfig(filePath).catch(() => undefined),
    })),
  )
  let hits = 0
  for (const { filePath, config } of files) {
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
  // stateHits never rejects; the counts are compared in spelling order, so the first best wins.
  const counted = await Promise.all(
    spellings.map(async (spelling) => ({
      spelling,
      hits: await stateHits(input.sources, input.state, spelling),
    })),
  )
  let best = first
  let bestHits = 0
  for (const { spelling, hits } of counted) {
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
  const spellings = await Promise.all(
    [...byFolder.values()].map((folderSpellings) => oldSpelling(folderSpellings, input)),
  )
  return spellings.filter((spelling) => spelling !== undefined)
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

/**
 * The projects whose folder is there. One that is gone (deleted, or not cloned again yet) is left
 * alone: nothing is created, recorded or gated, so it migrates once it is back. A failure kept
 * for it in this process is forgotten.
 */
export async function presentMigrationProjects(fs: McpMigrationFs, projects: readonly string[]) {
  const present: string[] = []
  const gone: string[] = []
  // Checked at once, then handled in order, as if each project were checked in turn.
  const checks = await Promise.allSettled(
    projects.map(async (projectPath) => ({
      projectPath,
      folderGone: await fs.projectFolderGone?.(projectPath),
    })),
  )
  for (const check of checks) {
    const { projectPath, folderGone } = settledValue(check)
    if (folderGone) {
      recordMcpFileMigrationOutcome(projectMcpPaths(projectPath).openwaggle)
      gone.push(projectPath)
    } else {
      present.push(projectPath)
    }
  }
  return { present, gone }
}
