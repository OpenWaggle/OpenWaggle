import { match } from '@diegogbrisa/ts-match'
import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import type { WorkspaceEntryMutationResult } from '@shared/types/workspace-files'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  workspaceContentQueryOptions,
  workspaceFileQueryOptions,
  workspaceFilesQueryOptions,
} from '@/queries/workspace-files'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import {
  removeWorkspaceDraftJournals,
  retargetWorkspaceDraftJournals,
} from '../lib/workspace-draft-journal'
import { flushWorkspaceEditorsBeforeMutation } from '../lib/workspace-editor-save-coordinator'
import { retargetRelativePath, type WorkspaceMutationAction } from '../lib/workspace-file-layout'
import {
  removeWorkspaceLanguageAssociations,
  retargetWorkspaceLanguageAssociations,
} from '../lib/workspace-language-associations'

const QUERY_SCOPE_SEGMENTS = 2

interface WorkspaceMutationInput {
  readonly projectPath: string | null
  readonly relativePath: string
  readonly onOpenFile: (path: string, line?: number | null) => void
  readonly onClose: () => void
}

async function runWithOverwriteConfirmation(
  operation: (overwrite: boolean) => Promise<WorkspaceEntryMutationResult>,
  detail: string,
) {
  try {
    return await operation(false)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('destination already exists')) {
      throw error
    }
    const confirmed = await api.showConfirm('Replace the existing workspace entry?', detail)
    if (!confirmed) return null
    return operation(true)
  }
}

function retargetWorkspaceState(
  input: WorkspaceMutationInput,
  previousPath: string,
  nextPath: string,
) {
  if (input.relativePath === previousPath || input.relativePath.startsWith(`${previousPath}/`)) {
    input.onOpenFile(retargetRelativePath(input.relativePath, previousPath, nextPath))
  }
}

function retargetWorkspaceLocalState(projectPath: string, previousPath: string, nextPath: string) {
  retargetWorkspaceDraftJournals(window.localStorage, projectPath, previousPath, nextPath)
  retargetWorkspaceLanguageAssociations(window.localStorage, projectPath, previousPath, nextPath)
}

export function useWorkspaceEntryMutations(input: WorkspaceMutationInput) {
  const [action, setAction] = useState<WorkspaceMutationAction | null>(null)
  const [path, setPath] = useState('')
  const showToast = useUIStore((state) => state.showToast)
  const queryClient = useQueryClient()

  function begin(nextAction: WorkspaceMutationAction) {
    const directory = input.relativePath.includes('/')
      ? input.relativePath.slice(0, input.relativePath.lastIndexOf('/') + 1)
      : ''
    const duplicatePath = input.relativePath.includes('.')
      ? input.relativePath.replace(/(\.[^./]+)$/u, '.copy$1')
      : `${input.relativePath}.copy`
    setPath(
      match(nextAction)
        .with('move', () => input.relativePath)
        .with('duplicate', () => duplicatePath)
        .with('create-directory', () => `${directory}new-folder`)
        .with('create-file', () => `${directory}untitled`)
        .with('trash', () => input.relativePath)
        .exhaustive(),
    )
    setAction(nextAction)
  }

  async function refresh() {
    const filesKey = workspaceFilesQueryOptions(
      input.projectPath,
      '',
      WORKSPACE_FILES.EXPLORER_RESULT_LIMIT,
    ).queryKey.slice(0, QUERY_SCOPE_SEGMENTS)
    const contentKey = workspaceContentQueryOptions(
      input.projectPath,
      '',
      WORKSPACE_FILES.CONTENT_RESULT_LIMIT,
    ).queryKey.slice(0, QUERY_SCOPE_SEGMENTS)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: filesKey }),
      queryClient.invalidateQueries({ queryKey: contentKey }),
    ])
  }

  async function move(sourcePath: string, targetPath: string) {
    if (!input.projectPath) return false
    const projectPath = input.projectPath
    await flushWorkspaceEditorsBeforeMutation(projectPath, sourcePath)
    const moved = await runWithOverwriteConfirmation(
      (overwrite) =>
        api.moveWorkspaceEntry({ projectPath, path: sourcePath, targetPath, overwrite }),
      `${targetPath} will be moved to the operating system Trash before ${sourcePath} is moved.`,
    )
    if (!moved) return false
    const previousPath = moved.previousPath ?? sourcePath
    retargetWorkspaceLocalState(projectPath, previousPath, moved.path)
    retargetWorkspaceState(input, previousPath, moved.path)
    return true
  }

  async function applySelectedMutation() {
    if (!input.projectPath || !action) return
    const projectPath = input.projectPath
    try {
      await match(action)
        .with('create-file', 'create-directory', async (selected) => {
          const created = await api.createWorkspaceEntry({
            projectPath,
            path,
            kind: selected === 'create-file' ? 'file' : 'directory',
          })
          if (selected === 'create-file') input.onOpenFile(created.path)
        })
        .with('move', async () => {
          await move(input.relativePath, path)
        })
        .with('duplicate', async () => {
          await flushWorkspaceEditorsBeforeMutation(projectPath, input.relativePath)
          const duplicated = await runWithOverwriteConfirmation(
            (overwrite) =>
              api.duplicateWorkspaceEntry({
                projectPath,
                path: input.relativePath,
                targetPath: path,
                overwrite,
              }),
            `${path} will be moved to the operating system Trash before the copy is created.`,
          )
          if (duplicated) input.onOpenFile(duplicated.path)
        })
        .with('trash', async () => {
          await flushWorkspaceEditorsBeforeMutation(projectPath, input.relativePath)
          await api.trashWorkspaceEntry({ projectPath, path: input.relativePath })
          removeWorkspaceDraftJournals(window.localStorage, projectPath, input.relativePath)
          removeWorkspaceLanguageAssociations(window.localStorage, projectPath, input.relativePath)
          input.onClose()
        })
        .exhaustive()
      setAction(null)
      await refresh()
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  async function refreshAllWatchedQueries() {
    const fileKey = workspaceFileQueryOptions(input.projectPath, null).queryKey.slice(
      0,
      QUERY_SCOPE_SEGMENTS,
    )
    await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: fileKey })])
  }

  return {
    action,
    path,
    setPath,
    close: () => setAction(null),
    begin,
    apply: applySelectedMutation,
    move,
    refresh,
    refreshAllWatchedQueries,
  }
}
