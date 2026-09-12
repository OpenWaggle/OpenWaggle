import { homedir } from 'node:os'
import { match } from '@diegogbrisa/ts-match'
import {
  type WorkspaceExternalEditorId,
  workspaceExternalEditorLabel,
} from '@shared/types/workspace-external-editor'
import { launchExternalApplication } from '../desktop-ui'
import {
  findAvailableWorkspaceExternalEditorCommand,
  findAvailableWorkspaceExternalEditorMacApplication,
  workspaceExternalEditorCommandAvailable,
  workspaceExternalEditorDefinition,
  workspaceExternalEditorPathAvailable,
} from './workspace-external-editor'

export function workspaceExternalEditorLaunchArguments(
  editorId: WorkspaceExternalEditorId,
  filePath: string,
  line?: number,
  column?: number,
): readonly string[] {
  const editor = workspaceExternalEditorDefinition(editorId)
  if (editor === undefined) return [filePath]
  const baseArgs = 'baseArgs' in editor ? editor.baseArgs : []
  if (line === undefined || line < 1) return [...baseArgs, filePath]
  const positionedPath = `${filePath}:${String(line)}${column && column > 0 ? `:${String(column)}` : ''}`

  const targetArgs = match(editor.launchStyle)
    .with('direct-path', () => [positionedPath])
    .with('goto', () => ['--goto', positionedPath])
    .with('line-column', () => [
      '--line',
      String(line),
      ...(column && column > 0 ? ['--column', String(column)] : []),
      filePath,
    ])
    .exhaustive()
  return [...baseArgs, ...targetArgs]
}

export function workspaceExternalEditorMacApplicationLaunchArguments(
  application: string,
  editorId: WorkspaceExternalEditorId,
  filePath: string,
  line?: number,
  column?: number,
): readonly string[] {
  if (line === undefined || line < 1) return ['-a', application, filePath]
  return [
    '-a',
    application,
    '--args',
    ...workspaceExternalEditorLaunchArguments(editorId, filePath, line, column),
  ]
}

export async function openWorkspaceFileInExternalEditor(input: {
  readonly editor: WorkspaceExternalEditorId
  readonly filePath: string
  readonly line?: number
  readonly column?: number
}): Promise<void> {
  const editor = workspaceExternalEditorDefinition(input.editor)
  if (editor === undefined) throw new Error(`Unknown external editor: ${String(input.editor)}`)

  const command = await findAvailableWorkspaceExternalEditorCommand(editor.commands, (candidate) =>
    workspaceExternalEditorCommandAvailable(candidate),
  )
  if (command !== undefined) {
    try {
      await launchExternalApplication(
        command,
        workspaceExternalEditorLaunchArguments(
          input.editor,
          input.filePath,
          input.line,
          input.column,
        ),
      )
      return
    } catch (error) {
      throw new Error(`Unable to launch ${workspaceExternalEditorLabel(input.editor)}.`, {
        cause: error,
      })
    }
  }

  if (process.platform === 'darwin') {
    const application = await findAvailableWorkspaceExternalEditorMacApplication(
      editor,
      homedir(),
      workspaceExternalEditorPathAvailable,
    )
    if (application !== undefined) {
      try {
        await launchExternalApplication(
          '/usr/bin/open',
          workspaceExternalEditorMacApplicationLaunchArguments(
            application,
            input.editor,
            input.filePath,
            input.line,
            input.column,
          ),
        )
        return
      } catch (error) {
        throw new Error(`Unable to launch ${workspaceExternalEditorLabel(input.editor)}.`, {
          cause: error,
        })
      }
    }
  }

  throw new Error(`${workspaceExternalEditorLabel(input.editor)} is not available on this machine.`)
}
