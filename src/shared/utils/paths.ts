import path from 'node:path'

/** Check whether `targetPath` is equal to or inside `basePath`. */
export function isPathInside(basePath: string, targetPath: string): boolean {
  const relative = path.relative(basePath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
