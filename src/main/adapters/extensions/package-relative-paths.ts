import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { isPathInside } from '../../utils/paths'
import { normalizeManifestRelativePath } from './content-hash-input'

export function resolvePackageRelativePath(packagePath: string, relativePath: string) {
  const resolvedPackagePath = path.resolve(packagePath)
  const resolvedCandidatePath = path.resolve(
    packagePath,
    normalizeManifestRelativePath(relativePath),
  )
  return isPathInside(resolvedPackagePath, resolvedCandidatePath) ? resolvedCandidatePath : null
}

export async function resolveSafePackageFilePath(packagePath: string, relativePath: string) {
  const candidatePath = resolvePackageRelativePath(packagePath, relativePath)
  if (!candidatePath) {
    return null
  }

  const [realPackagePath, realCandidatePath] = await Promise.all([
    realpath(packagePath),
    realpath(candidatePath),
  ])
  return isPathInside(realPackagePath, realCandidatePath) ? realCandidatePath : null
}
