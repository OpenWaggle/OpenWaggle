import fs from 'node:fs/promises'
import path from 'node:path'

interface WorkspacePathContext {
  readonly root: string
  readonly caseSensitive: boolean
}

function isMissingPath(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

function flippedAsciiCase(value: string) {
  return value.replace(/[A-Za-z]/u, (character) =>
    character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase(),
  )
}

async function detectCaseSensitive(root: string, exists: boolean) {
  if (!exists) return process.platform !== 'darwin' && process.platform !== 'win32'
  const name = path.basename(root)
  const alternateName = flippedAsciiCase(name)
  if (alternateName === name) return process.platform !== 'darwin' && process.platform !== 'win32'
  try {
    const [original, alternate] = await Promise.all([
      fs.stat(root),
      fs.stat(path.join(path.dirname(root), alternateName)),
    ])
    return original.dev !== alternate.dev || original.ino !== alternate.ino
  } catch (error) {
    if (isMissingPath(error)) return true
    throw error
  }
}

async function workspaceContext(
  workingPath: string,
  caseSensitiveOverride: boolean | undefined,
): Promise<WorkspacePathContext> {
  let root: string
  let exists = true
  try {
    root = await fs.realpath(workingPath)
  } catch (error) {
    if (!isMissingPath(error)) throw error
    root = path.resolve(workingPath)
    exists = false
  }
  return {
    root,
    caseSensitive: caseSensitiveOverride ?? (await detectCaseSensitive(root, exists)),
  }
}

async function resolveThroughExistingAncestor(candidate: string) {
  const suffix: string[] = []
  let cursor = candidate
  while (true) {
    try {
      return path.resolve(await fs.realpath(cursor), ...suffix)
    } catch (error) {
      if (!isMissingPath(error)) throw error
      const parent = path.dirname(cursor)
      if (parent === cursor) throw error
      suffix.unshift(path.basename(cursor))
      cursor = parent
    }
  }
}

async function resolveClaimPath(context: WorkspacePathContext, relativePath: string) {
  const target = await resolveThroughExistingAncestor(path.resolve(context.root, relativePath))
  const relative = path.relative(context.root, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined
  }
  const portable = relative === '' ? '.' : relative.split(path.sep).join('/')
  return context.caseSensitive ? portable : portable.toLowerCase()
}

/** Resolve aliases for conflict comparison without changing the claim path shown to users. */
export function createSessionDelegationClaimPathResolver(
  options: { caseSensitive?: boolean } = {},
) {
  const contexts = new Map<string, Promise<WorkspacePathContext>>()
  const targets = new Map<string, Promise<string | undefined>>()
  return (workingPath: string, relativePath: string) => {
    const key = JSON.stringify([workingPath, relativePath])
    const cached = targets.get(key)
    if (cached) return cached
    let context = contexts.get(workingPath)
    if (!context) {
      context = workspaceContext(workingPath, options.caseSensitive)
      contexts.set(workingPath, context)
    }
    const resolved = context.then((value) => resolveClaimPath(value, relativePath))
    targets.set(key, resolved)
    return resolved
  }
}
