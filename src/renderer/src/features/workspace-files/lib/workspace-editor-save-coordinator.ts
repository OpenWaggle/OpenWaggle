interface ActiveWorkspaceEditor {
  readonly projectPath: string
  readonly filePath: string
  readonly flush: () => Promise<void>
}

const activeEditors = new Set<ActiveWorkspaceEditor>()

export function registerWorkspaceEditorSave(editor: ActiveWorkspaceEditor) {
  activeEditors.add(editor)
  return () => {
    activeEditors.delete(editor)
  }
}

export async function flushWorkspaceEditorsBeforeMutation(projectPath: string, entryPath: string) {
  const editors = [...activeEditors].filter(
    (editor) =>
      editor.projectPath === projectPath &&
      (editor.filePath === entryPath || editor.filePath.startsWith(`${entryPath}/`)),
  )
  await Promise.all(editors.map((editor) => editor.flush()))
}
