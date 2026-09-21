import path from 'node:path'

/** Resolve a CLI-supplied project path against the caller's working directory. */
export function resolveCliProjectPath(projectPath: string, workingDirectory = process.cwd()) {
  return path.resolve(workingDirectory, projectPath)
}

export function resolveCliProjectPaths(
  projectPaths: readonly string[] | undefined,
  workingDirectory = process.cwd(),
) {
  return projectPaths?.map((projectPath) => resolveCliProjectPath(projectPath, workingDirectory))
}
