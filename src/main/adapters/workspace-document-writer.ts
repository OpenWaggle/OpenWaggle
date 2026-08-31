import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import type {
  WorkspaceDocumentApplyInput,
  WorkspaceDocumentApplyResult,
  WorkspaceDocumentChange,
  WorkspaceFileWriteInput,
  WorkspaceFileWriteResult,
} from '@shared/types/workspace-files'
import {
  diskContent,
  storeWorkspaceDocumentSession,
  workspaceDocumentSession,
} from './workspace-document-sessions'
import { encodeWorkspaceText, workspaceFileRevision } from './workspace-file-content'
import { resolveExistingWorkspaceFile } from './workspace-file-paths'
import { rememberWorkspaceFile } from './workspace-file-search'
import { withWorkspacePathLocks } from './workspace-path-locks'

function applyDocumentBatch(content: string, changes: readonly WorkspaceDocumentChange[]) {
  const ordered = [...changes].sort((left, right) => left.rangeOffset - right.rangeOffset)
  const parts: string[] = []
  let cursor = 0
  let projectedLength = content.length
  for (const change of ordered) {
    const end = change.rangeOffset + change.rangeLength
    if (change.rangeOffset < cursor || change.rangeLength < 0 || end > content.length) {
      throw new Error('Document edit ranges are invalid or overlap in the current version.')
    }
    projectedLength += change.text.length - change.rangeLength
    if (projectedLength > WORKSPACE_EDITOR_PERFORMANCE.FOCUSED_EDIT_MAX_BYTES) {
      return null
    }
    parts.push(content.slice(cursor, change.rangeOffset), change.text)
    cursor = end
  }
  parts.push(content.slice(cursor))
  return parts.join('')
}

function applyDocumentBatches(input: {
  readonly content: string
  readonly version: number
  readonly batches: WorkspaceDocumentApplyInput['batches']
}) {
  let nextContent = input.content
  let nextVersion = input.version
  for (const batch of input.batches) {
    if (batch.version !== nextVersion + 1) {
      return {
        status: 'out-of-sync' as const,
        message: 'Document edit versions must be contiguous and ordered.',
        expectedVersion: nextVersion + 1,
      }
    }
    const applied = applyDocumentBatch(nextContent, batch.changes)
    if (applied === null) return { status: 'too-large' as const }
    nextContent = applied
    nextVersion = batch.version
  }
  return { status: 'applied' as const, content: nextContent, version: nextVersion }
}

async function atomicWrite(filePath: string, content: Uint8Array, mode: number) {
  const temporaryPath = `${filePath}.openwaggle-${randomUUID()}.tmp`
  try {
    const handle = await fs.open(temporaryPath, 'wx', mode)
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(temporaryPath, filePath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true })
    throw error
  }
}

export async function applyWorkspaceDocumentEdits(
  input: WorkspaceDocumentApplyInput,
): Promise<WorkspaceDocumentApplyResult> {
  const initial = await resolveExistingWorkspaceFile(input)
  return withWorkspacePathLocks([initial.realFilePath], async () =>
    applyWorkspaceDocumentEditsLocked(input),
  )
}

async function applyWorkspaceDocumentEditsLocked(
  input: WorkspaceDocumentApplyInput,
): Promise<WorkspaceDocumentApplyResult> {
  const resolved = await resolveExistingWorkspaceFile(input)
  const session = workspaceDocumentSession(resolved.projectRoot, resolved.relativePath)
  if (!session || session.revision !== input.expectedRevision) {
    return {
      status: 'conflict',
      message: 'The document session is stale. Reload the file before saving edits.',
    }
  }
  if (session.version !== input.baseVersion) {
    return {
      status: 'out-of-sync',
      message: 'The edit batch does not continue the current document version.',
      expectedVersion: session.version,
    }
  }
  const diskData = await fs.readFile(resolved.realFilePath)
  const diskRevision = workspaceFileRevision(resolved.stats.mtimeMs, resolved.stats.size, diskData)
  if (diskRevision !== session.revision) {
    return {
      status: 'conflict',
      message: 'The file changed on disk. Compare it with your draft before choosing a version.',
    }
  }
  const applied = applyDocumentBatches({
    content: session.content,
    version: session.version,
    batches: input.batches,
  })
  if (applied.status === 'out-of-sync') return applied
  if (applied.status === 'too-large') {
    return { status: 'too-large', message: 'Focused file editing is limited to 1 MiB.' }
  }
  const nextLineEnding =
    input.normalizeLineEnding ?? session.editorConfigPolicy.lineEnding ?? session.lineEnding
  const nextEncoding =
    input.targetEncoding ?? session.editorConfigPolicy.encoding ?? session.encoding
  const encoded = encodeWorkspaceText(diskContent(applied.content, nextLineEnding), nextEncoding)
  if (encoded.byteLength > WORKSPACE_EDITOR_PERFORMANCE.FOCUSED_EDIT_MAX_BYTES) {
    return {
      status: 'too-large',
      message: 'Focused file editing is limited to 1 MiB.',
    }
  }
  await atomicWrite(resolved.realFilePath, encoded, resolved.stats.mode)
  const stats = await fs.stat(resolved.realFilePath)
  const revision = workspaceFileRevision(stats.mtimeMs, stats.size, encoded)
  session.content = applied.content
  session.version = applied.version
  session.revision = revision
  session.lineEnding = nextLineEnding
  session.encoding = nextEncoding
  storeWorkspaceDocumentSession(session)
  rememberWorkspaceFile(resolved.projectRoot, resolved.relativePath)
  return {
    status: 'saved',
    version: applied.version,
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    revision,
    encoding: nextEncoding,
    lineEnding: nextLineEnding,
  }
}

export async function writeWorkspaceFile(
  input: WorkspaceFileWriteInput,
): Promise<WorkspaceFileWriteResult> {
  const initial = await resolveExistingWorkspaceFile(input)
  return withWorkspacePathLocks([initial.realFilePath], async () => writeWorkspaceFileLocked(input))
}

async function writeWorkspaceFileLocked(
  input: WorkspaceFileWriteInput,
): Promise<WorkspaceFileWriteResult> {
  const resolved = await resolveExistingWorkspaceFile(input)
  const currentContent =
    resolved.stats.size <= WORKSPACE_EDITOR_PERFORMANCE.FOCUSED_EDIT_MAX_BYTES
      ? await fs.readFile(resolved.realFilePath)
      : undefined
  const currentRevision = workspaceFileRevision(
    resolved.stats.mtimeMs,
    resolved.stats.size,
    currentContent,
  )
  if (currentRevision !== input.expectedRevision) {
    return {
      status: 'conflict',
      message: 'The file changed on disk. Reload it before saving your edits.',
    }
  }
  if (
    Buffer.byteLength(input.content, 'utf8') > WORKSPACE_EDITOR_PERFORMANCE.FOCUSED_EDIT_MAX_BYTES
  ) {
    return {
      status: 'too-large',
      message: 'Focused file editing is limited to 1 MiB.',
    }
  }
  await fs.writeFile(resolved.realFilePath, input.content, 'utf8')
  const stats = await fs.stat(resolved.realFilePath)
  rememberWorkspaceFile(resolved.projectRoot, resolved.relativePath)
  return {
    status: 'saved',
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    revision: workspaceFileRevision(stats.mtimeMs, stats.size, Buffer.from(input.content, 'utf8')),
  }
}
