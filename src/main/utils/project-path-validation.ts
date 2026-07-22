import fs from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'

export function isPathInsideDirectory(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export function validateProjectPath(
  projectPath: string | null | undefined,
): Effect.Effect<string | undefined, Error> {
  return Effect.gen(function* () {
    if (projectPath == null) {
      return undefined
    }

    const normalized = projectPath.trim()
    if (!normalized) {
      return undefined
    }

    if (!path.isAbsolute(normalized)) {
      return yield* Effect.fail(new Error('Project path must be absolute.'))
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const realProjectPath = await fs.realpath(normalized)
        const stats = await fs.stat(realProjectPath)
        if (!stats.isDirectory()) {
          throw new Error('Project path must be a directory.')
        }
        return realProjectPath
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
  })
}

export function validateRequiredProjectPath(
  projectPath: string | null | undefined,
): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const validated = yield* validateProjectPath(projectPath)
    if (!validated) {
      return yield* Effect.fail(new Error('Project path is required.'))
    }
    return validated
  })
}
