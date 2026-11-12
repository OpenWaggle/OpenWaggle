import {
  isWorkspaceExternalEditorId,
  type WorkspaceExternalEditor,
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

export function resolveAndPersistPreferredWorkspaceExternalEditor(
  storage: Storage,
  availableEditors: readonly WorkspaceExternalEditor[],
): WorkspaceExternalEditorId | null {
  const stored = readPreferredWorkspaceExternalEditor(storage)
  if (stored && availableEditors.some((editor) => editor.id === stored)) return stored
  const fallback = availableEditors[0]?.id ?? null
  if (fallback) writePreferredWorkspaceExternalEditor(storage, fallback)
  return fallback
}

export async function openAbsoluteFileInPreferredWorkspaceEditor(input: {
  readonly api: {
    listWorkspaceExternalEditors(): Promise<WorkspaceExternalEditor[]>
    openAbsoluteFileExternal(options: {
      readonly path: string
      readonly editor: WorkspaceExternalEditorId
      readonly line?: number
      readonly column?: number
    }): Promise<void>
  }
  readonly storage: Storage
  readonly path: string
  readonly line: number | null
  readonly column: number | null
}): Promise<void> {
  const availableEditors = await input.api.listWorkspaceExternalEditors()
  const editor = resolveAndPersistPreferredWorkspaceExternalEditor(input.storage, availableEditors)
  if (!editor) throw new Error(`No supported editor is available to open ${input.path}.`)
  await input.api.openAbsoluteFileExternal({
    path: input.path,
    editor,
    ...(input.line === null ? {} : { line: input.line }),
    ...(input.column === null ? {} : { column: input.column }),
  })
}
