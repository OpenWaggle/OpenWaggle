import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeUnknownExactOrThrow, parseJsonUnknown } from '@shared/schema'
import { actionManifestSchema } from '@shared/schemas/action-definitions'
import type { ActionManifest } from '@shared/types/action-definitions'
import { isEnoent, isNodeError } from '@shared/utils/node-error'
import { EMPTY_ACTION_MANIFEST } from '../../domain/project-action-catalog'
import { readTaskSource } from './task-source-files'

const CONFIG_DIRECTORY = '.openwaggle'
const MANIFEST_SOURCE = '.openwaggle/actions.json'
const JSON_INDENT = 2

/** The canonical path and directory instance must both survive an interrupted publication. */
export async function readActionWorkspaceIdentity(workspace: string) {
  try {
    const metadata = await lstat(workspace, { bigint: true })
    if (!metadata.isDirectory() || (await realpath(workspace)) !== workspace) return null
    return {
      device: metadata.dev.toString(),
      inode: metadata.ino.toString(),
      birthtime: metadata.birthtimeNs.toString(),
    }
  } catch (error) {
    if (isEnoent(error) || isNodeError(error, 'ENOTDIR') || isNodeError(error, 'ELOOP')) return null
    throw error
  }
}

export function actionContentRevision(content: string | null): string {
  return createHash('sha256')
    .update(content === null ? 'missing' : `present:${content}`)
    .digest('hex')
}

export function serializeActionManifest(manifest: ActionManifest): string {
  return `${JSON.stringify(decodeUnknownExactOrThrow(actionManifestSchema, manifest), null, JSON_INDENT)}\n`
}

/** Broken links and unreadable files are errors, never empty configuration. */
export async function readActionConfigSource(
  workspace: string,
  source: string,
): Promise<string | null> {
  const directory = await lstat(join(workspace, CONFIG_DIRECTORY)).catch((error: unknown) => {
    if (isEnoent(error)) return null
    throw error
  })
  if (directory?.isSymbolicLink())
    throw new Error(`${CONFIG_DIRECTORY} must be a directory, not a symbolic link.`)
  const file = await lstat(join(workspace, source)).catch((error: unknown) => {
    if (isEnoent(error)) return null
    throw error
  })
  if (file?.isSymbolicLink())
    throw new Error(`${source} must be a regular file, not a symbolic link.`)
  return readTaskSource(workspace, source)
}

export async function readActionManifest(workspace: string) {
  const raw = await readActionConfigSource(workspace, MANIFEST_SOURCE)
  try {
    const manifest =
      raw === null
        ? EMPTY_ACTION_MANIFEST
        : decodeUnknownExactOrThrow(actionManifestSchema, parseJsonUnknown(raw))
    return { manifest, revision: actionContentRevision(raw) }
  } catch (cause) {
    throw new Error(
      `Invalid ${MANIFEST_SOURCE}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
}
