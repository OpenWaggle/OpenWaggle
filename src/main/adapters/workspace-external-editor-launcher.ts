import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { match } from '@diegogbrisa/ts-match'
import {
  type WorkspaceExternalEditorId,
  workspaceExternalEditorLabel,
} from '@shared/types/workspace-external-editor'
import { getSafeChildEnv } from '../env'
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
): readonly string[] {
  const editor = workspaceExternalEditorDefinition(editorId)
  if (editor === undefined || line === undefined || line < 1) return [filePath]

  return match(editor.launchStyle)
    .with('direct-path', () => [filePath])
    .with('goto', () => ['--goto', `${filePath}:${String(line)}`])
    .with('line', () => ['--line', String(line), filePath])
    .exhaustive()
}

function spawnDetached(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: getSafeChildEnv(),
    })
    const handleError = (error: Error) => {
      child.removeListener('spawn', handleSpawn)
      reject(error)
    }
    const handleSpawn = () => {
      child.removeListener('error', handleError)
      child.unref()
      resolve()
    }
    child.once('error', handleError)
    child.once('spawn', handleSpawn)
  })
}

export async function openWorkspaceFileInExternalEditor(input: {
  readonly editor: WorkspaceExternalEditorId
  readonly filePath: string
  readonly line?: number
}): Promise<void> {
  const editor = workspaceExternalEditorDefinition(input.editor)
  if (editor === undefined) throw new Error(`Unknown external editor: ${String(input.editor)}`)

  const command = await findAvailableWorkspaceExternalEditorCommand(editor.commands, (candidate) =>
    workspaceExternalEditorCommandAvailable(candidate),
  )
  if (command !== undefined) {
    try {
      await spawnDetached(
        command,
        workspaceExternalEditorLaunchArguments(input.editor, input.filePath, input.line),
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
        await spawnDetached('/usr/bin/open', ['-a', application, input.filePath])
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
