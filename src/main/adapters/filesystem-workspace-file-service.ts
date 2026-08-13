import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  WorkspaceContentMatch,
  WorkspaceFileEntry,
  WorkspaceFileReadResult,
  WorkspaceFileWriteInput,
  WorkspaceFileWriteResult,
} from '@shared/types/workspace-files'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { shell } from 'electron'
import { WorkspaceFileError } from '../errors'
import { WorkspaceFileService } from '../ports/workspace-file-service'
import { isPathInsideDirectory } from '../utils/project-path-validation'
import {
  hasBinaryBytes,
  LANGUAGE_BY_EXTENSION,
  MIME_BY_EXTENSION,
  workspaceFilePreviewKind,
  workspaceFileRevision,
} from './workspace-file-content'
import {
  filterGitignoredWorkspacePaths,
  WORKSPACE_FILE_GLOB_IGNORES,
} from './workspace-file-ignore'
import { rememberWorkspaceFile, searchIndexedFiles } from './workspace-file-search'

const INDEX_TTL_MS = 30_000
const MAX_READ_BYTES = 25 * 1024 * 1024
const MAX_EDITABLE_TEXT_BYTES = 2 * 1024 * 1024
const MAX_CONTENT_SEARCH_BYTES = 1024 * 1024
const CONTENT_SEARCH_CONCURRENCY = 12

interface ProjectFileIndex {
  readonly expiresAt: number
  readonly entries: readonly WorkspaceFileEntry[]
}

const indexByProject = new Map<string, ProjectFileIndex>()
const indexPromiseByProject = new Map<string, Promise<ProjectFileIndex>>()
const contentSearchGenerationByProject = new Map<string, number>()

function workspaceFileError(operation: string, cause: unknown) {
  return new WorkspaceFileError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  })
}

async function resolveProjectRoot(projectPath: string) {
  const trimmed = projectPath.trim()
  if (!path.isAbsolute(trimmed)) throw new Error('Project path must be absolute.')
  const projectRoot = await fs.realpath(trimmed)
  const stats = await fs.stat(projectRoot)
  if (!stats.isDirectory()) throw new Error('Project path must be a directory.')
  return projectRoot
}

function normalizeRelativeFilePath(relativePath: string) {
  const slashPath = relativePath.replaceAll('\\', '/').trim()
  if (!slashPath || path.posix.isAbsolute(slashPath)) {
    throw new Error('Workspace file path must be relative.')
  }
  const normalized = path.posix.normalize(slashPath)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Workspace file path cannot leave the project root.')
  }
  return normalized.replace(/^\.\//, '')
}

async function resolveExistingFile(input: { readonly projectPath: string; readonly path: string }) {
  const projectRoot = await resolveProjectRoot(input.projectPath)
  const relativePath = normalizeRelativeFilePath(input.path)
  const candidatePath = path.resolve(projectRoot, relativePath)
  if (!isPathInsideDirectory(projectRoot, candidatePath)) {
    throw new Error('Workspace file path cannot leave the project root.')
  }
  const realFilePath = await fs.realpath(candidatePath)
  if (!isPathInsideDirectory(projectRoot, realFilePath)) {
    throw new Error('Workspace file symlink resolves outside the project root.')
  }
  const stats = await fs.stat(realFilePath)
  if (!stats.isFile()) throw new Error('Workspace path must resolve to a file.')
  return { projectRoot, relativePath, realFilePath, stats }
}

async function buildProjectIndex(projectRoot: string): Promise<ProjectFileIndex> {
  const fg = await import('fast-glob')
  const paths = await fg.default('**/*', {
    cwd: projectRoot,
    ignore: WORKSPACE_FILE_GLOB_IGNORES,
    onlyFiles: true,
    followSymbolicLinks: false,
    unique: true,
    dot: true,
  })
  const filteredPaths = await filterGitignoredWorkspacePaths(projectRoot, paths, fg.default)
  const entries = filteredPaths
    .map((entry) => entry.replaceAll('\\', '/'))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => ({ path: entry, basename: path.posix.basename(entry) }))
  return { entries, expiresAt: Date.now() + INDEX_TTL_MS }
}

async function projectIndex(projectPath: string) {
  const projectRoot = await resolveProjectRoot(projectPath)
  const existing = indexByProject.get(projectRoot)
  if (existing && existing.expiresAt > Date.now()) return { projectRoot, index: existing }

  const pending = indexPromiseByProject.get(projectRoot)
  if (pending) return { projectRoot, index: await pending }

  const promise = buildProjectIndex(projectRoot)
  indexPromiseByProject.set(projectRoot, promise)
  try {
    const index = await promise
    indexByProject.set(projectRoot, index)
    return { projectRoot, index }
  } finally {
    indexPromiseByProject.delete(projectRoot)
  }
}

async function readWorkspaceFile(input: {
  readonly projectPath: string
  readonly path: string
}): Promise<WorkspaceFileReadResult> {
  const resolved = await resolveExistingFile(input)
  rememberWorkspaceFile(resolved.projectRoot, resolved.relativePath)
  const extension = path.extname(resolved.relativePath).toLowerCase()
  const mimeType = MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
  const base = {
    path: resolved.relativePath,
    basename: path.posix.basename(resolved.relativePath),
    size: resolved.stats.size,
    modifiedAt: resolved.stats.mtimeMs,
    revision: workspaceFileRevision(resolved.stats.mtimeMs, resolved.stats.size),
    mimeType,
  }
  if (resolved.stats.size > MAX_READ_BYTES) {
    return {
      ...base,
      previewKind: 'oversized',
      reason: 'This file is too large to load safely in the workspace editor.',
    }
  }

  if (
    resolved.stats.size > MAX_EDITABLE_TEXT_BYTES &&
    !mimeType.startsWith('image/') &&
    extension !== '.pdf'
  ) {
    return {
      ...base,
      previewKind: 'oversized',
      reason: 'This text file is too large to edit safely in the workspace editor.',
    }
  }

  const data = await fs.readFile(resolved.realFilePath)
  const kind = workspaceFilePreviewKind(extension, data)
  if (kind === 'image' || kind === 'pdf') {
    return { ...base, previewKind: kind, data: new Uint8Array(data) }
  }
  if (kind === 'binary') {
    return { ...base, previewKind: kind, reason: 'Binary files cannot be edited as text.' }
  }
  return {
    ...base,
    previewKind: kind,
    content: data.toString('utf8'),
    ...(LANGUAGE_BY_EXTENSION[extension] ? { language: LANGUAGE_BY_EXTENSION[extension] } : {}),
  }
}

async function writeWorkspaceFile(
  input: WorkspaceFileWriteInput,
): Promise<WorkspaceFileWriteResult> {
  const resolved = await resolveExistingFile(input)
  const currentRevision = workspaceFileRevision(resolved.stats.mtimeMs, resolved.stats.size)
  if (currentRevision !== input.expectedRevision) {
    return {
      status: 'conflict',
      message: 'The file changed on disk. Reload it before saving your edits.',
    }
  }
  if (Buffer.byteLength(input.content, 'utf8') > MAX_EDITABLE_TEXT_BYTES) {
    return {
      status: 'too-large',
      message: 'This text file is too large to save in the workspace editor.',
    }
  }
  await fs.writeFile(resolved.realFilePath, input.content, 'utf8')
  const stats = await fs.stat(resolved.realFilePath)
  rememberWorkspaceFile(resolved.projectRoot, resolved.relativePath)
  return {
    status: 'saved',
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    revision: workspaceFileRevision(stats.mtimeMs, stats.size),
  }
}

async function searchWorkspaceContent(input: {
  readonly projectPath: string
  readonly query: string
  readonly limit: number
}) {
  const query = input.query.trim()
  if (!query) return []
  const generation = (contentSearchGenerationByProject.get(input.projectPath) ?? 0) + 1
  contentSearchGenerationByProject.set(input.projectPath, generation)
  const { projectRoot, index } = await projectIndex(input.projectPath)
  const lowerQuery = query.toLowerCase()
  const matches: WorkspaceContentMatch[] = []
  let cursor = 0

  async function worker() {
    while (
      contentSearchGenerationByProject.get(input.projectPath) === generation &&
      cursor < index.entries.length &&
      matches.length < input.limit
    ) {
      const entry = index.entries[cursor]
      cursor += 1
      if (!entry) continue
      try {
        const resolved = await resolveExistingFile({ projectPath: projectRoot, path: entry.path })
        if (resolved.stats.size > MAX_CONTENT_SEARCH_BYTES) continue
        const data = await fs.readFile(resolved.realFilePath)
        if (hasBinaryBytes(data)) continue
        const lines = data.toString('utf8').split(/\r?\n/)
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          if (matches.length >= input.limit) break
          const lineText = lines[lineIndex] ?? ''
          const matchStart = lineText.toLowerCase().indexOf(lowerQuery)
          if (matchStart < 0) continue
          matches.push({
            path: entry.path,
            basename: entry.basename,
            lineNumber: lineIndex + 1,
            lineText: lineText.trim(),
            matchStart,
            matchLength: query.length,
          })
        }
      } catch {
        // Files may disappear while the index is being searched.
      }
    }
  }

  await Promise.all(Array.from({ length: CONTENT_SEARCH_CONCURRENCY }, () => worker()))
  return matches.slice(0, input.limit)
}

function cancelWorkspaceContentSearch(projectPath: string) {
  const generation = (contentSearchGenerationByProject.get(projectPath) ?? 0) + 1
  contentSearchGenerationByProject.set(projectPath, generation)
}

export const FilesystemWorkspaceFileLive = Layer.succeed(
  WorkspaceFileService,
  WorkspaceFileService.of({
    searchFiles: (input) =>
      Effect.tryPromise({
        try: async () => {
          const { projectRoot, index } = await projectIndex(input.projectPath)
          return searchIndexedFiles(projectRoot, index.entries, input.query, input.limit)
        },
        catch: (cause) => workspaceFileError('search-files', cause),
      }),
    searchContent: (input) =>
      Effect.tryPromise({
        try: () => searchWorkspaceContent(input),
        catch: (cause) => workspaceFileError('search-content', cause),
      }),
    cancelContentSearch: (input) =>
      Effect.sync(() => cancelWorkspaceContentSearch(input.projectPath)),
    readFile: (input) =>
      Effect.tryPromise({
        try: () => readWorkspaceFile(input),
        catch: (cause) => workspaceFileError('read-file', cause),
      }),
    writeFile: (input) =>
      Effect.tryPromise({
        try: () => writeWorkspaceFile(input),
        catch: (cause) => workspaceFileError('write-file', cause),
      }),
    openFile: (input) =>
      Effect.tryPromise({
        try: async () => {
          const filePath = (await resolveExistingFile(input)).realFilePath
          const result = await shell.openPath(filePath)
          if (result) throw new Error(result)
        },
        catch: (cause) => workspaceFileError('open-file', cause),
      }),
  }),
)
