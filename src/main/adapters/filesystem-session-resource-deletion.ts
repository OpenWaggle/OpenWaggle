import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isEnoent } from '@shared/utils/node-error'

function isWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && relative !== '..'
}

async function assertManagedParent(realRoot: string, relativePath: string) {
  let current = realRoot
  for (const segment of path.dirname(relativePath).split(path.sep)) {
    if (!segment || segment === '.') continue
    current = path.join(current, segment)
    const stats = await fs.lstat(current)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('Session resource cleanup parent is not a managed directory.')
    }
  }
}

function sameFile(
  before: { readonly dev: number; readonly ino: number },
  after: { readonly dev: number; readonly ino: number },
) {
  return before.dev === after.dev && before.ino === after.ino
}

async function removeExistingManagedFile(root: string, managedPath: string) {
  const lexicalRoot = path.resolve(root)
  const lexicalPath = path.resolve(managedPath)
  const realRoot = await fs.realpath(lexicalRoot)
  const isUnderLexicalRoot = isWithinRoot(lexicalRoot, lexicalPath)
  const isUnderRealRoot = isWithinRoot(realRoot, lexicalPath)
  if (!isUnderLexicalRoot && !isUnderRealRoot) {
    throw new Error('Session resource cleanup path escapes the managed resource directory.')
  }
  const relativePath = path.relative(isUnderLexicalRoot ? lexicalRoot : realRoot, lexicalPath)
  const candidate = path.join(realRoot, relativePath)
  await assertManagedParent(realRoot, relativePath)
  const before = await fs.lstat(candidate)
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error('Session resource cleanup target is not a managed regular file.')
  }
  if ((await fs.realpath(candidate)) !== candidate) {
    throw new Error('Session resource cleanup target changed during validation.')
  }

  const tombstone = path.join(realRoot, `.deleting-${randomUUID()}`)
  await fs.rename(candidate, tombstone)
  const after = await fs.lstat(tombstone)
  if (!after.isFile() || !sameFile(before, after)) {
    throw new Error('Session resource cleanup target changed before deletion.')
  }
  await fs.unlink(tombstone)
}

export async function removeManagedSessionResource(root: string, managedPath: string) {
  try {
    await removeExistingManagedFile(root, managedPath)
  } catch (cause) {
    if (isEnoent(cause)) return
    throw cause
  }
}
