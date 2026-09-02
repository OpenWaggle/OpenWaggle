import fs from 'node:fs/promises'
import type { WorkspaceContentMatch, WorkspaceFileEntry } from '@shared/types/workspace-files'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { showItemInFolder } from '../desktop-ui'
import { WorkspaceFileService } from '../ports/workspace-file-service'
import { applyWorkspaceDocumentEdits, writeWorkspaceFile } from './workspace-document-writer'
import {
  createWorkspaceEntry,
  duplicateWorkspaceEntry,
  moveWorkspaceEntry,
  trashWorkspaceEntry,
} from './workspace-entry-mutations'
import { listAvailableWorkspaceExternalEditors } from './workspace-external-editor'
import { openWorkspaceFileInExternalEditor } from './workspace-external-editor-launcher'
import { hasBinaryBytes } from './workspace-file-content'
import {
  filterGitignoredWorkspacePaths,
  WORKSPACE_FILE_GLOB_IGNORES,
} from './workspace-file-ignore'
import { readWorkspaceFilePage } from './workspace-file-pages'
import {
  resolveExistingWorkspaceEntry,
  resolveExistingWorkspaceFile,
  resolveWorkspaceProjectRoot,
  workspaceFileError,
} from './workspace-file-paths'
import { readWorkspaceFile } from './workspace-file-reader'
import { searchIndexedFiles } from './workspace-file-search'

const INDEX_TTL_MS = 30_000
const MAX_CONTENT_SEARCH_BYTES = 1024 * 1024
const CONTENT_SEARCH_CONCURRENCY = 12

interface ProjectFileIndex {
  readonly expiresAt: number
  readonly entries: readonly WorkspaceFileEntry[]
}

const indexByProject = new Map<string, ProjectFileIndex>()
const indexPromiseByProject = new Map<string, Promise<ProjectFileIndex>>()
const indexGenerationByProject = new Map<string, number>()
const contentSearchGenerationByProject = new Map<string, number>()

export function invalidateWorkspaceFileIndex(projectRoot: string) {
  indexGenerationByProject.set(projectRoot, (indexGenerationByProject.get(projectRoot) ?? 0) + 1)
  indexByProject.delete(projectRoot)
  indexPromiseByProject.delete(projectRoot)
  cancelWorkspaceContentSearch(projectRoot)
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
    .map((entry) => ({ path: entry, basename: entry.slice(entry.lastIndexOf('/') + 1) }))
  return { entries, expiresAt: Date.now() + INDEX_TTL_MS }
}

async function projectIndex(projectPath: string) {
  const projectRoot = await resolveWorkspaceProjectRoot(projectPath)
  const existing = indexByProject.get(projectRoot)
  if (existing && existing.expiresAt > Date.now()) return { projectRoot, index: existing }
  const pending = indexPromiseByProject.get(projectRoot)
  if (pending) return { projectRoot, index: await pending }
  const generation = indexGenerationByProject.get(projectRoot) ?? 0
  const promise = buildProjectIndex(projectRoot)
  indexPromiseByProject.set(projectRoot, promise)
  try {
    const index = await promise
    if ((indexGenerationByProject.get(projectRoot) ?? 0) !== generation) {
      return projectIndex(projectRoot)
    }
    indexByProject.set(projectRoot, index)
    return { projectRoot, index }
  } finally {
    if (indexPromiseByProject.get(projectRoot) === promise) {
      indexPromiseByProject.delete(projectRoot)
    }
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
        const resolved = await resolveExistingWorkspaceFile({
          projectPath: projectRoot,
          path: entry.path,
        })
        if (resolved.stats.size > MAX_CONTENT_SEARCH_BYTES) continue
        const data = await fs.readFile(resolved.realFilePath)
        if (hasBinaryBytes(data)) continue
        const lines = data.toString('utf8').split(/\r?\n/u)
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

async function mutateWorkspaceEntry(
  operation: typeof createWorkspaceEntry,
  input: Parameters<typeof createWorkspaceEntry>[0],
) {
  const result = await operation(input)
  invalidateWorkspaceFileIndex(result.projectRoot)
  return {
    path: result.path,
    ...(result.previousPath ? { previousPath: result.previousPath } : {}),
  }
}

async function mutateExistingWorkspaceEntry(
  operation:
    | typeof moveWorkspaceEntry
    | typeof duplicateWorkspaceEntry
    | typeof trashWorkspaceEntry,
  input: Parameters<typeof moveWorkspaceEntry>[0],
) {
  const result = await operation(input)
  invalidateWorkspaceFileIndex(result.projectRoot)
  return {
    path: result.path,
    ...(result.previousPath ? { previousPath: result.previousPath } : {}),
  }
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
    readFileWithEncoding: (input) =>
      Effect.tryPromise({
        try: () => readWorkspaceFile(input, input.encoding),
        catch: (cause) => workspaceFileError('read-file-with-encoding', cause),
      }),
    writeFile: (input) =>
      Effect.tryPromise({
        try: () => writeWorkspaceFile(input),
        catch: (cause) => workspaceFileError('write-file', cause),
      }),
    applyDocumentEdits: (input) =>
      Effect.tryPromise({
        try: () => applyWorkspaceDocumentEdits(input),
        catch: (cause) => workspaceFileError('apply-document-edits', cause),
      }),
    listExternalEditors: () =>
      Effect.tryPromise({
        try: () => listAvailableWorkspaceExternalEditors(),
        catch: (cause) => workspaceFileError('list-external-editors', cause),
      }),
    openFile: (input) =>
      Effect.tryPromise({
        try: async () => {
          const filePath = (await resolveExistingWorkspaceFile(input)).realFilePath
          await openWorkspaceFileInExternalEditor({
            editor: input.editor,
            filePath,
            ...(input.line === undefined ? {} : { line: input.line }),
          })
        },
        catch: (cause) => workspaceFileError('open-file', cause),
      }),
    createEntry: (input) =>
      Effect.tryPromise({
        try: () => mutateWorkspaceEntry(createWorkspaceEntry, input),
        catch: (cause) => workspaceFileError('create-entry', cause),
      }),
    moveEntry: (input) =>
      Effect.tryPromise({
        try: () => mutateExistingWorkspaceEntry(moveWorkspaceEntry, input),
        catch: (cause) => workspaceFileError('move-entry', cause),
      }),
    duplicateEntry: (input) =>
      Effect.tryPromise({
        try: () => mutateExistingWorkspaceEntry(duplicateWorkspaceEntry, input),
        catch: (cause) => workspaceFileError('duplicate-entry', cause),
      }),
    trashEntry: (input) =>
      Effect.tryPromise({
        try: () => mutateExistingWorkspaceEntry(trashWorkspaceEntry, input),
        catch: (cause) => workspaceFileError('trash-entry', cause),
      }),
    revealEntry: (input) =>
      Effect.tryPromise({
        try: async () => showItemInFolder((await resolveExistingWorkspaceEntry(input)).realPath),
        catch: (cause) => workspaceFileError('reveal-entry', cause),
      }),
    readPage: (input) =>
      Effect.tryPromise({
        try: () => readWorkspaceFilePage(input),
        catch: (cause) => workspaceFileError('read-page', cause),
      }),
  }),
)
