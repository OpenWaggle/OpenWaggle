import path from 'node:path'

interface PendingPathLock {
  readonly paths: readonly string[]
  readonly resolve: (release: () => void) => void
}

const activePathLocks = new Map<symbol, readonly string[]>()
const pendingPathLocks: PendingPathLock[] = []

function normalizedLockPath(candidate: string) {
  const resolved = path.resolve(candidate)
  return process.platform === 'darwin' || process.platform === 'win32'
    ? resolved.toLowerCase()
    : resolved
}

function pathsOverlap(left: string, right: string) {
  return (
    left === right ||
    left.startsWith(`${right}${path.sep}`) ||
    right.startsWith(`${left}${path.sep}`)
  )
}

function conflictsWithActive(paths: readonly string[]) {
  return [...activePathLocks.values()].some((active) =>
    active.some((activePath) => paths.some((candidate) => pathsOverlap(activePath, candidate))),
  )
}

function releasePathLock(token: symbol) {
  activePathLocks.delete(token)
  drainPathLocks()
}

function grantPathLock(request: PendingPathLock) {
  const token = Symbol('workspace-path-lock')
  activePathLocks.set(token, request.paths)
  request.resolve(() => releasePathLock(token))
}

function drainPathLocks() {
  for (let index = 0; index < pendingPathLocks.length; ) {
    const request = pendingPathLocks[index]
    if (!request || conflictsWithActive(request.paths)) {
      index += 1
      continue
    }
    pendingPathLocks.splice(index, 1)
    grantPathLock(request)
  }
}

function acquirePathLocks(paths: readonly string[]) {
  const normalized = [...new Set(paths.map(normalizedLockPath))].sort()
  return new Promise<() => void>((resolve) => {
    const request = { paths: normalized, resolve }
    if (conflictsWithActive(normalized)) {
      pendingPathLocks.push(request)
      return
    }
    grantPathLock(request)
  })
}

/** Serializes overlapping file and directory operations while allowing unrelated files to proceed. */
export async function withWorkspacePathLocks<T>(
  paths: readonly string[],
  operation: () => Promise<T>,
) {
  const release = await acquirePathLocks(paths)
  try {
    return await operation()
  } finally {
    release()
  }
}
