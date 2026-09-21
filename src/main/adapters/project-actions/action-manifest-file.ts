import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
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

export async function writeActionManifest(
  workspace: string,
  expectedRevision: string,
  manifest: ActionManifest,
  requireWorkspace: () => Promise<void>,
): Promise<void> {
  const content = serializeActionManifest(manifest)
  await requireWorkspace()
  // Never recreate a removed checkout, even if it disappears after the identity check.
  await mkdir(join(workspace, CONFIG_DIRECTORY)).catch((error: unknown) => {
    if (!isNodeError(error, 'EEXIST')) throw error
  })
  await requireWorkspace()
  const target = join(workspace, MANIFEST_SOURCE)
  const temporary = `${target}.${randomUUID()}.tmp`
  if ((await readActionManifest(workspace)).revision !== expectedRevision)
    throw new Error(
      'Project Actions changed on disk. Your draft has been kept; reload before saving.',
    )
  try {
    await requireWorkspace()
    const handle = await open(temporary, 'wx')
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    if ((await readActionManifest(workspace)).revision !== expectedRevision)
      throw new Error('Project Actions changed on disk while saving. Your draft has been kept.')
    await requireWorkspace()
    await rename(temporary, target)
    if ((await readActionManifest(workspace)).revision !== actionContentRevision(content))
      throw new Error('Project Actions changed while verifying the saved file.')
  } finally {
    // A replaced path no longer names our temporary file.
    await requireWorkspace().then(() => rm(temporary, { force: true }))
  }
}
