import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  WorkspaceEntryCreateInput,
  WorkspaceEntryMutationInput,
  WorkspaceEntryMutationResult,
} from '@shared/types/workspace-files'
import { trashItem } from '../desktop-ui'
import { isPathInsideDirectory } from '../utils/project-path-validation'
import {
  removeWorkspaceDocumentSessions,
  retargetWorkspaceDocumentSessions,
} from './workspace-document-sessions'
import { resolveExistingWorkspaceEntry, resolveNewWorkspaceEntry } from './workspace-file-paths'
import { withWorkspacePathLocks } from './workspace-path-locks'

async function removeExistingDestination(targetPath: string, overwrite: boolean | undefined) {
  try {
    await fs.lstat(targetPath)
    if (!overwrite) throw new Error('The destination already exists.')
    await trashItem(targetPath)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : null
    if (code !== 'ENOENT') throw error
  }
}

async function destinationRefersToSource(
  targetPath: string,
  source: { readonly stats: { readonly dev: number; readonly ino: number } },
) {
  try {
    const targetStats = await fs.stat(targetPath)
    return targetStats.dev === source.stats.dev && targetStats.ino === source.stats.ino
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : null
    if (code === 'ENOENT') return false
    throw error
  }
}

async function destinationContainsSource(targetPath: string, sourcePath: string) {
  try {
    return isPathInsideDirectory(await fs.realpath(targetPath), sourcePath)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : null
    if (code === 'ENOENT') return false
    throw error
  }
}

async function renameCaseOnly(sourcePath: string, targetPath: string) {
  const temporaryPath = path.join(
    path.dirname(sourcePath),
    `.openwaggle-case-rename-${randomUUID()}.tmp`,
  )
  await fs.rename(sourcePath, temporaryPath)
  try {
    await fs.rename(temporaryPath, targetPath)
  } catch (error) {
    await fs.rename(temporaryPath, sourcePath).catch(() => undefined)
    throw error
  }
}

function validateDistinctDestination(input: {
  readonly operation: 'moved' | 'duplicated'
  readonly sourcePath: string
  readonly targetPath: string
  readonly sourceIsDirectory: boolean
}) {
  if (input.sourcePath === input.targetPath) throw new Error('Choose a different destination path.')
  if (input.sourcePath.startsWith(`${input.targetPath}/`)) {
    throw new Error('The destination cannot contain the source entry.')
  }
  if (input.sourceIsDirectory && input.targetPath.startsWith(`${input.sourcePath}/`)) {
    throw new Error(`A directory cannot be ${input.operation} inside itself.`)
  }
}

export async function createWorkspaceEntry(
  input: WorkspaceEntryCreateInput,
): Promise<WorkspaceEntryMutationResult & { readonly projectRoot: string }> {
  const target = await resolveNewWorkspaceEntry(input)
  await withWorkspacePathLocks([target.targetPath], async () => {
    if (input.kind === 'directory') {
      await fs.mkdir(target.targetPath)
    } else {
      const handle = await fs.open(target.targetPath, 'wx')
      await handle.close()
    }
  })
  return { path: target.relativePath, projectRoot: target.projectRoot }
}

export async function moveWorkspaceEntry(
  input: WorkspaceEntryMutationInput,
): Promise<WorkspaceEntryMutationResult & { readonly projectRoot: string }> {
  if (!input.targetPath) throw new Error('A destination path is required.')
  const [source, target] = await Promise.all([
    resolveExistingWorkspaceEntry(input),
    resolveNewWorkspaceEntry({
      projectPath: input.projectPath,
      path: input.targetPath,
    }),
  ])
  return withWorkspacePathLocks([source.realPath, target.targetPath], async () => {
    validateDistinctDestination({
      operation: 'moved',
      sourcePath: source.relativePath,
      targetPath: target.relativePath,
      sourceIsDirectory: source.stats.isDirectory(),
    })
    if (await destinationRefersToSource(target.targetPath, source)) {
      if (
        source.realPath !== target.targetPath &&
        source.realPath.toLowerCase() === target.targetPath.toLowerCase()
      ) {
        await renameCaseOnly(source.realPath, target.targetPath)
        retargetWorkspaceDocumentSessions(
          source.projectRoot,
          source.relativePath,
          target.relativePath,
        )
        return {
          path: target.relativePath,
          previousPath: source.relativePath,
          projectRoot: source.projectRoot,
        }
      }
      throw new Error('The destination refers to the source entry.')
    }
    if (await destinationContainsSource(target.targetPath, source.realPath)) {
      throw new Error('The destination cannot contain the source entry.')
    }
    await removeExistingDestination(target.targetPath, input.overwrite)
    await fs.rename(source.realPath, target.targetPath)
    retargetWorkspaceDocumentSessions(source.projectRoot, source.relativePath, target.relativePath)
    return {
      path: target.relativePath,
      previousPath: source.relativePath,
      projectRoot: source.projectRoot,
    }
  })
}

export async function duplicateWorkspaceEntry(
  input: WorkspaceEntryMutationInput,
): Promise<WorkspaceEntryMutationResult & { readonly projectRoot: string }> {
  if (!input.targetPath) throw new Error('A destination path is required.')
  const [source, target] = await Promise.all([
    resolveExistingWorkspaceEntry(input),
    resolveNewWorkspaceEntry({
      projectPath: input.projectPath,
      path: input.targetPath,
    }),
  ])
  return withWorkspacePathLocks([source.realPath, target.targetPath], async () => {
    validateDistinctDestination({
      operation: 'duplicated',
      sourcePath: source.relativePath,
      targetPath: target.relativePath,
      sourceIsDirectory: source.stats.isDirectory(),
    })
    if (await destinationRefersToSource(target.targetPath, source)) {
      throw new Error('A file cannot be duplicated onto itself.')
    }
    if (await destinationContainsSource(target.targetPath, source.realPath)) {
      throw new Error('The destination cannot contain the source entry.')
    }
    await removeExistingDestination(target.targetPath, input.overwrite)
    await fs.cp(source.realPath, target.targetPath, {
      recursive: source.stats.isDirectory(),
      errorOnExist: true,
      force: false,
    })
    return {
      path: target.relativePath,
      previousPath: source.relativePath,
      projectRoot: source.projectRoot,
    }
  })
}

export async function trashWorkspaceEntry(
  input: WorkspaceEntryMutationInput,
): Promise<WorkspaceEntryMutationResult & { readonly projectRoot: string }> {
  const source = await resolveExistingWorkspaceEntry(input)
  return withWorkspacePathLocks([source.realPath], async () => {
    await trashItem(source.realPath)
    removeWorkspaceDocumentSessions(source.projectRoot, source.relativePath)
    return { path: source.relativePath, projectRoot: source.projectRoot }
  })
}
