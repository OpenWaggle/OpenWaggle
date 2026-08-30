import type {
  WorkspaceTextEncoding,
  WorkspaceTextFileReadResult,
} from '@shared/types/workspace-files'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import { useWorkspaceFileEditing } from '../hooks/useWorkspaceFileEditing'
import { WorkspaceFileEditorContent } from './WorkspaceFileEditorContent'
import { WorkspaceFileEditorToolbar, workspaceEncodingLabel } from './WorkspaceFileEditorToolbar'

export function WorkspaceFileEditor({
  projectPath,
  file,
  targetLine,
}: {
  readonly projectPath: string
  readonly file: WorkspaceTextFileReadResult
  readonly targetLine: number | null
}) {
  const editing = useWorkspaceFileEditing({ projectPath, file, targetLine })
  const [focusedEdit, setFocusedEdit] = useState(editing.status !== 'saved')
  const showToast = useUIStore((state) => state.showToast)

  async function runEditorAction(action: () => Promise<unknown>) {
    try {
      await action()
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  async function reopenWithEncoding(encoding: WorkspaceTextEncoding) {
    if (editing.status !== 'saved') {
      const confirmed = await api.showConfirm(
        'Discard the current draft and reopen this file?',
        `OpenWaggle will decode ${file.path} as ${workspaceEncodingLabel(encoding)}.`,
      )
      if (!confirmed) return
    }
    try {
      await editing.reopenWithEncoding(encoding)
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  async function saveWithEncoding(encoding: WorkspaceTextEncoding) {
    try {
      await editing.saveWithEncoding(encoding)
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <WorkspaceFileEditorToolbar
        state={{
          status: editing.status,
          errorMessage: editing.errorMessage,
          wordWrap: editing.wordWrap,
          canPreview: editing.canPreview,
          preview: editing.preview,
          language: editing.language,
          encoding: editing.encoding,
          lineEnding: editing.lineEnding,
          focusedEdit,
        }}
        actions={{
          onReload: () => void runEditorAction(editing.reloadFromDisk),
          onCompare: () => void runEditorAction(editing.compareWithDisk),
          onRestoreDraft: () => void runEditorAction(editing.restoreDraftOverDisk),
          onRetry: () => void runEditorAction(editing.saveSnapshot),
          onToggleWrap: editing.toggleWordWrap,
          onTogglePreview: () => editing.setPreview((current) => !current),
          onLanguageChange: editing.setLanguage,
          onAssociateLanguagePattern: editing.associateLanguagePattern,
          onReopenEncoding: (encoding) => void reopenWithEncoding(encoding),
          onSaveEncoding: (encoding) => void saveWithEncoding(encoding),
          onBeginEdit: () => {
            editing.setPreview(false)
            setFocusedEdit(true)
          },
          onFinishEdit: () => {
            editing.captureSnapshot()
            setFocusedEdit(false)
          },
        }}
        file={file}
      />
      <WorkspaceFileEditorContent
        file={file}
        projectPath={projectPath}
        targetLine={targetLine}
        editing={editing}
        focusedEdit={focusedEdit}
      />
    </div>
  )
}
