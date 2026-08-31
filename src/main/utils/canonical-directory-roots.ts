import fs from 'node:fs/promises'
import path from 'node:path'

async function canonicalDirectory(root: string, label: string) {
  const canonical = await fs.realpath(path.resolve(root))
  const stats = await fs.stat(canonical)
  if (!stats.isDirectory()) throw new Error(`${label} must be a directory: ${root}`)
  return canonical
}

export async function canonicalizeExistingDirectoryRoots(
  roots: readonly string[] | undefined,
  label: string,
) {
  if (!roots) return undefined
  return [
    ...new Set(await Promise.all(roots.map((root) => canonicalDirectory(root, label)))),
  ].sort()
}

export async function assertCanonicalDirectoryRoots(roots: readonly string[], label: string) {
  const canonical = await Promise.all(
    roots.map(async (root) => {
      const absolute = path.resolve(root)
      const resolved = await canonicalDirectory(absolute, label)
      if (resolved !== absolute) {
        throw new Error(`${label} changed after it was granted: ${root}`)
      }
      return resolved
    }),
  )
  return [...new Set(canonical)].sort()
}
