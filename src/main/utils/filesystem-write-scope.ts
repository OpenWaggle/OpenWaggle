import fs from 'node:fs/promises'
import path from 'node:path'

async function nearestExistingDirectory(candidate: string) {
  let current = path.resolve(candidate)
  while (true) {
    try {
      const resolved = await fs.realpath(current)
      const info = await fs.stat(resolved)
      return info.isDirectory()
        ? { lexicalPath: current, canonicalPath: resolved }
        : { lexicalPath: path.dirname(current), canonicalPath: path.dirname(resolved) }
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) {
        throw new Error(`No existing ancestor was found for ${candidate}.`, { cause: error })
      }
      current = parent
    }
  }
}

function pathInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export async function assertFilesystemWriteScope(input: {
  readonly roots: readonly string[]
  readonly destinationPath: string
}) {
  const destination = path.resolve(input.destinationPath)
  const destinationAncestor = await nearestExistingDirectory(path.dirname(destination))
  for (const root of input.roots) {
    const absoluteRoot = path.resolve(root)
    if (!pathInside(absoluteRoot, destination)) continue
    const realRoot = await fs.realpath(absoluteRoot)
    if (!pathInside(realRoot, destinationAncestor.canonicalPath)) continue
    const unresolved = path.relative(destinationAncestor.lexicalPath, destination)
    return {
      rootPath: realRoot,
      destinationPath: path.resolve(destinationAncestor.canonicalPath, unresolved),
    }
  }
  throw new Error('The export destination is outside the granted filesystem scope.')
}
