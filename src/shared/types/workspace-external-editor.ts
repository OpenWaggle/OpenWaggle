/**
 * External editors that OpenWaggle can launch without delegating to the
 * operating system's (often surprising) default application.
 *
 * Keep this list deliberately curated. The main process owns command probing
 * and launch details; the renderer only ever receives these stable ids and
 * display labels.
 */
export const WORKSPACE_EXTERNAL_EDITOR_DEFINITIONS = [
  { id: 'vscode', label: 'Visual Studio Code' },
  { id: 'vscode-insiders', label: 'Visual Studio Code Insiders' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'zed', label: 'Zed' },
  { id: 'vscodium', label: 'VSCodium' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'sublime', label: 'Sublime Text' },
  { id: 'idea', label: 'IntelliJ IDEA' },
  { id: 'webstorm', label: 'WebStorm' },
  { id: 'pycharm', label: 'PyCharm' },
  { id: 'goland', label: 'GoLand' },
  { id: 'clion', label: 'CLion' },
  { id: 'rider', label: 'Rider' },
] as const

export type WorkspaceExternalEditorId = (typeof WORKSPACE_EXTERNAL_EDITOR_DEFINITIONS)[number]['id']

export interface WorkspaceExternalEditor {
  readonly id: WorkspaceExternalEditorId
  readonly label: string
}

export function isWorkspaceExternalEditorId(value: string): value is WorkspaceExternalEditorId {
  return WORKSPACE_EXTERNAL_EDITOR_DEFINITIONS.some((editor) => editor.id === value)
}

export function workspaceExternalEditorLabel(editorId: WorkspaceExternalEditorId): string {
  return (
    WORKSPACE_EXTERNAL_EDITOR_DEFINITIONS.find((editor) => editor.id === editorId)?.label ??
    'External editor'
  )
}

export interface WorkspaceFileExternalOpenInput {
  readonly projectPath: string
  readonly path: string
  readonly editor: WorkspaceExternalEditorId
  readonly line?: number
}
