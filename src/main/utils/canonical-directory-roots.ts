import fs from 'node:fs/promises'
import path from 'node:path'

const CANONICAL_DIRECTORY_CONCURRENCY = 8

async function canonicalDirectory(root: string, label: string) {
  const canonical = await fs.realpath(path.resolve(root))
  const stats = await fs.stat(canonical)
  if (!stats.isDirectory()) throw new Error(`${label} must be a directory: ${root}`)
  return canonical
}

async function mapCanonicalDirectoryRoots(
  roots: readonly string[],
  operation: (root: string) => Promise<string>,
) {
  const canonical = new Array<string>(roots.length)
  const entries = roots.entries()
  let failed = false
  let failure: unknown
  const workers = Array.from(
    { length: Math.min(roots.length, CANONICAL_DIRECTORY_CONCURRENCY) },
    async () => {
      for (const [index, root] of entries) {
        if (failed) return
        try {
          canonical[index] = await operation(root)
        } catch (cause) {
          if (!failed) failure = cause
          failed = true
        }
      }
    },
  )
  await Promise.all(workers)
  if (failed) throw failure
  return canonical
}

export async function canonicalizeExistingDirectoryRoots(
  roots: readonly string[] | undefined,
  label: string,
) {
  if (!roots) return undefined
  const canonical = await mapCanonicalDirectoryRoots([...new Set(roots)], (root) =>
    canonicalDirectory(root, label),
  )
  return [...new Set(canonical)].sort()
}

export async function assertCanonicalDirectoryRoots(roots: readonly string[], label: string) {
  const canonical = await mapCanonicalDirectoryRoots([...new Set(roots)], async (root) => {
    const absolute = path.resolve(root)
    const resolved = await canonicalDirectory(absolute, label)
    if (resolved !== absolute) {
      throw new Error(`${label} changed after it was granted: ${root}`)
    }
    return resolved
  })
  return [...new Set(canonical)].sort()
}
