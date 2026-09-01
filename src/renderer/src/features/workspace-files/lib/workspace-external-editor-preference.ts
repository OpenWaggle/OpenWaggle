import {
  isWorkspaceExternalEditorId,
  type WorkspaceExternalEditorId,
} from '@shared/types/workspace-external-editor'

export const WORKSPACE_EXTERNAL_EDITOR_STORAGE_KEY = 'openwaggle:preferred-external-editor'

export function readPreferredWorkspaceExternalEditor(
  storage: Storage,
): WorkspaceExternalEditorId | null {
  try {
    const value = storage.getItem(WORKSPACE_EXTERNAL_EDITOR_STORAGE_KEY)
    return value !== null && isWorkspaceExternalEditorId(value) ? value : null
  } catch {
    return null
  }
}

export function writePreferredWorkspaceExternalEditor(
  storage: Storage,
  editorId: WorkspaceExternalEditorId,
): void {
  try {
    storage.setItem(WORKSPACE_EXTERNAL_EDITOR_STORAGE_KEY, editorId)
  } catch {
    // A full or restricted storage area must not prevent opening a file.
  }
}
