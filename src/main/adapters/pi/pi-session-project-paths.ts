import { realpathSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import path from 'node:path'

/**
 * Which project a Pi session belongs to, from the folder its header records (ADR 0050).
 */

/** Pi's directory-name encoding of a working directory, without the closing `--`. */
export function encodedPathPrefix(directory: string) {
  return `--${path
    .resolve(directory)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}`
}

export function sessionDirectoryMayBelongTo(directoryName: string, projectPrefix: string) {
  return directoryName === `${projectPrefix}--` || directoryName.startsWith(`${projectPrefix}-`)
}

export function isPathInsideProject(candidate: string, projectPath: string) {
  const relative = path.relative(path.resolve(projectPath), path.resolve(candidate))
  if (path.isAbsolute(relative)) return false
  return relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

/** A project as OpenWaggle lists it, and the physical folder it resolves to. */
export interface ProjectLocation {
  readonly projectPath: string
  readonly physicalPath: string
}

/**
 * Pi records the physical folder it ran in (`process.cwd()`), so a project opened through a
 * symbolic link, or under `/tmp` on macOS, is matched by both its path and the folder it resolves
 * to. A path that cannot be resolved is matched as written.
 */
export async function projectLocations(projectPaths: readonly string[]) {
  return Promise.all(
    projectPaths.map(async (projectPath) => ({
      projectPath,
      physicalPath: await realpath(projectPath).catch(() => projectPath),
    })),
  )
}

/** The most specific project the header's cwd is in, by the path OpenWaggle lists it under. */
export function owningProject(cwd: string, projects: readonly ProjectLocation[]) {
  let owner: { readonly projectPath: string; readonly depth: number } | null = null
  for (const project of projects) {
    const match = [project.projectPath, project.physicalPath].find((candidate) =>
      isPathInsideProject(cwd, candidate),
    )
    if (match === undefined) continue
    if (owner === null || match.length > owner.depth) {
      owner = { projectPath: project.projectPath, depth: match.length }
    }
  }
  return owner?.projectPath ?? null
}

/**
 * The physical folder a path resolves to, as Pi's `process.cwd()` reports it when `pi` runs there;
 * the path as written when it cannot be resolved.
 */
export function physicalPath(directory: string) {
  try {
    return realpathSync(directory)
  } catch {
    return directory
  }
}

/** Whether `candidate` is inside the project, by its path or the folder it resolves to. */
export function isInsideProjectLocation(candidate: string, projectPath: string) {
  return (
    isPathInsideProject(candidate, projectPath) ||
    isPathInsideProject(candidate, physicalPath(projectPath))
  )
}
