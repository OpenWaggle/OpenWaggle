import { lstat, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'

function isWithinRoot(candidate: string, root: string) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isFileSystemError(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code
}

async function mkdirWithoutSymbolicLinks(targetPath: string) {
  const resolved = path.resolve(targetPath)
  const parsed = path.parse(resolved)
  const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)
  let current = parsed.root
  for (const segment of segments) {
    current = path.join(current, segment)
    try {
      const entry = await lstat(current)
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(
          `Refusing hosted worktree destination component ${JSON.stringify(current)} because it is not a real directory.`,
        )
      }
    } catch (error) {
      if (!isFileSystemError(error, 'ENOENT')) throw error
      await mkdir(current).catch((mkdirError: unknown) => {
        if (!isFileSystemError(mkdirError, 'EEXIST')) throw mkdirError
      })
      const created = await lstat(current)
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new Error(
          `Refusing hosted worktree destination component ${JSON.stringify(current)} because it changed during creation.`,
          { cause: error },
        )
      }
    }
  }
}

export async function prepareHostedWorktreeDestination(
  storageRoot: string,
  repositoryParent: string,
) {
  await mkdirWithoutSymbolicLinks(storageRoot)
  const canonicalStorageRoot = await realpath(storageRoot)
  if (canonicalStorageRoot !== path.resolve(storageRoot)) {
    throw new Error(
      `Refusing to create hosted worktrees beneath symbolic-link destination ${JSON.stringify(storageRoot)}.`,
    )
  }
  await mkdirWithoutSymbolicLinks(repositoryParent)
  const canonicalRepositoryParent = await realpath(repositoryParent)
  if (
    canonicalRepositoryParent !== path.resolve(repositoryParent) ||
    !isWithinRoot(canonicalRepositoryParent, canonicalStorageRoot)
  ) {
    throw new Error(
      `Refusing to create a hosted worktree outside ${JSON.stringify(canonicalStorageRoot)}.`,
    )
  }
}
