import fs from 'node:fs/promises'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionExportArtifactError } from '../errors'
import { SessionExportResourceResolver } from '../ports/session-export-resource-resolver'
import { isPathInsideDirectory } from '../utils/project-path-validation'

const MAX_BUNDLED_RESOURCE_BYTES = 256 * 1024 * 1024
const filesystemConstants = process.getBuiltinModule('node:fs').constants
const OPEN_READ_NO_FOLLOW = filesystemConstants.O_RDONLY | (filesystemConstants.O_NOFOLLOW ?? 0)

function resourceError(operation: string, cause: unknown) {
  return new SessionExportArtifactError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  })
}

function normalizeRelativePath(resourcePath: string) {
  const slashPath = resourcePath.replaceAll('\\', '/').trim()
  if (!slashPath || path.posix.isAbsolute(slashPath)) {
    throw new Error('Bundled workspace resource path must be relative.')
  }
  const normalized = path.posix.normalize(slashPath)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Bundled workspace resource path cannot leave the Session workspace.')
  }
  return normalized.replace(/^\.\//, '')
}

function sameFile(
  left: { readonly dev: number | bigint; readonly ino: number | bigint },
  right: { readonly dev: number | bigint; readonly ino: number | bigint },
) {
  return left.dev === right.dev && left.ino === right.ino
}

export async function openFilesystemSessionExportResource(input: {
  readonly workspacePath: string
  readonly resourcePath: string
}) {
  const workspaceRoot = await fs.realpath(input.workspacePath)
  const relativePath = normalizeRelativePath(input.resourcePath)
  const candidate = path.resolve(workspaceRoot, relativePath)
  if (!isPathInsideDirectory(workspaceRoot, candidate)) {
    throw new Error('Bundled workspace resource path cannot leave the Session workspace.')
  }

  // Open first, then prove that the descriptor is the same file reached by the authorized
  // canonical path. From this point onward the descriptor, not the path, is the authority.
  // An ancestor swapped before/during this sequence either resolves outside the workspace or
  // produces a different device/inode pair and is rejected.
  const sourceHandle = await fs.open(candidate, OPEN_READ_NO_FOLLOW)
  try {
    const openedStats = await sourceHandle.stat()
    if (!openedStats.isFile()) throw new Error('Bundled workspace resource must be a file.')
    if (openedStats.size > MAX_BUNDLED_RESOURCE_BYTES) {
      throw new Error('Bundled workspace resource exceeds the 256 MiB safety limit.')
    }
    const sourcePath = await fs.realpath(candidate)
    if (!isPathInsideDirectory(workspaceRoot, sourcePath)) {
      throw new Error('Bundled workspace resource resolves outside the Session workspace.')
    }
    const linkedStats = await fs.stat(sourcePath)
    if (!sameFile(openedStats, linkedStats)) {
      throw new Error('Bundled workspace resource changed while it was being authorized.')
    }
    return { path: relativePath, sourceHandle, size: openedStats.size }
  } catch (error) {
    await sourceHandle.close().catch(() => undefined)
    throw error
  }
}

function resolveResource(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly resource: { readonly path: string }
    readonly expectedWorkspacePath?: string
  },
) {
  return Effect.tryPromise({
    try: async () => {
      const rows = await Effect.runPromise(
        sql<{ readonly working_path: string; readonly lifecycle_state: string }>`
          SELECT workspace_resources.working_path, workspace_resources.lifecycle_state
          FROM session_workspace_bindings
          JOIN workspace_resources ON workspace_resources.id = session_workspace_bindings.workspace_id
          WHERE session_workspace_bindings.session_id = ${input.sessionId}
          LIMIT 1
        `,
      )
      const workspace = rows[0]
      if (!workspace) throw new Error('Session workspace not found.')
      if (workspace.lifecycle_state !== 'ready') throw new Error('Session workspace is not ready.')
      const liveWorkspacePath = await fs.realpath(workspace.working_path)
      if (input.expectedWorkspacePath && liveWorkspacePath !== input.expectedWorkspacePath) {
        throw new Error('Session workspace changed after export resource authorization.')
      }
      return openFilesystemSessionExportResource({
        workspacePath: input.expectedWorkspacePath ?? liveWorkspacePath,
        resourcePath: input.resource.path,
      })
    },
    catch: (cause) => resourceError('resolve-export-resource', cause),
  })
}

export const FilesystemSessionExportResourceResolverLive = Layer.effect(
  SessionExportResourceResolver,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionExportResourceResolver.of({
      resolve: (input) => resolveResource(sql, input),
    })
  }),
)
