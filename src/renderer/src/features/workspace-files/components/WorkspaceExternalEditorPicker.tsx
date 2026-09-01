import type {
  WorkspaceExternalEditor,
  WorkspaceExternalEditorId,
} from '@shared/types/workspace-external-editor'
import { Check, ChevronDown, Code2, ExternalLink, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import {
  readPreferredWorkspaceExternalEditor,
  writePreferredWorkspaceExternalEditor,
} from '../lib/workspace-external-editor-preference'

interface WorkspaceExternalEditorPickerProps {
  readonly projectPath: string
  readonly relativePath: string
  readonly line: number | null
  readonly onError: (error: unknown) => void
}

function editorIsAvailable(
  editors: readonly WorkspaceExternalEditor[],
  editorId: WorkspaceExternalEditorId,
) {
  return editors.some((editor) => editor.id === editorId)
}

function WorkspaceExternalEditorMenu({
  open,
  editors,
  isLoading,
  preferredEditor,
  preferredLabel,
  onOpenChange,
  onSelectEditor,
}: {
  readonly open: boolean
  readonly editors: readonly WorkspaceExternalEditor[]
  readonly isLoading: boolean
  readonly preferredEditor: WorkspaceExternalEditorId | null
  readonly preferredLabel: string
  readonly onOpenChange: (open: boolean) => void
  readonly onSelectEditor: (editorId: WorkspaceExternalEditorId) => void
}) {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      placement="bottom-end"
      role="menu"
      className="w-64 p-1"
      trigger={({ toggle }) => (
        <Button
          variant={open ? 'accent' : 'ghost'}
          size="icon-sm"
          title="Choose external editor"
          aria-label="Choose external editor"
          onClick={toggle}
        >
          <ChevronDown className="size-3.5" />
        </Button>
      )}
    >
      <div className="px-2 py-1.5 text-xs text-text-muted">
        {preferredEditor
          ? `Current editor: ${preferredLabel}`
          : 'Choose an editor to open this file'}
      </div>
      {isLoading ? (
        <Button
          variant="unstyled"
          role="menuitem"
          disabled
          className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs text-text-muted"
        >
          <LoaderCircle className="size-3.5 animate-spin" /> Looking for installed editors…
        </Button>
      ) : editors.length === 0 ? (
        <div className="px-2 py-2 text-xs leading-5 text-text-muted">
          No supported editors found. Install VS Code, Cursor, Zed, or another supported editor and
          try again.
        </div>
      ) : (
        editors.map((editor) => (
          <Button
            key={editor.id}
            variant="unstyled"
            role="menuitemradio"
            aria-checked={editor.id === preferredEditor}
            className="flex h-8 w-full items-center justify-between rounded px-2 text-xs text-text-secondary hover:bg-bg-hover"
            onClick={() => onSelectEditor(editor.id)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Code2 className="size-3.5 shrink-0 text-text-muted" />
              <span className="truncate">{editor.label}</span>
            </span>
            {editor.id === preferredEditor ? <Check className="size-3.5 text-accent" /> : null}
          </Button>
        ))
      )}
      <div className="mt-1 border-t border-border px-2 pt-1.5 text-xs text-text-muted">
        Your choice is remembered for the next file.
      </div>
    </Popover>
  )
}

export function WorkspaceExternalEditorPicker({
  projectPath,
  relativePath,
  line,
  onError,
}: WorkspaceExternalEditorPickerProps) {
  const [open, setOpen] = useState(false)
  const [editors, setEditors] = useState<readonly WorkspaceExternalEditor[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [preferredEditor, setPreferredEditor] = useState<WorkspaceExternalEditorId | null>(() =>
    readPreferredWorkspaceExternalEditor(window.localStorage),
  )

  function loadEditors() {
    if (hasLoaded || isLoading) return
    setIsLoading(true)
    void api
      .listWorkspaceExternalEditors()
      .then((availableEditors) => {
        setEditors(availableEditors)
        setPreferredEditor((current) => {
          if (current === null || editorIsAvailable(availableEditors, current)) return current
          return null
        })
        setHasLoaded(true)
      })
      .catch(onError)
      .finally(() => setIsLoading(false))
  }

  function setMenuOpen(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) loadEditors()
  }

  async function openEditor(editorId: WorkspaceExternalEditorId) {
    setOpen(false)
    try {
      await api.openWorkspaceFileExternal({
        projectPath,
        path: relativePath,
        editor: editorId,
        ...(line === null ? {} : { line }),
      })
      writePreferredWorkspaceExternalEditor(window.localStorage, editorId)
      setPreferredEditor(editorId)
    } catch (error) {
      onError(error)
    }
  }

  const preferredLabel =
    editors.find((editor) => editor.id === preferredEditor)?.label ?? 'Choose editor'

  return (
    <div className="flex items-center gap-px">
      <Button
        variant="ghost"
        size="icon-sm"
        title={preferredEditor ? `Open in ${preferredLabel}` : 'Choose an external editor'}
        aria-label="Open file in external editor"
        onClick={() => {
          if (preferredEditor && (!hasLoaded || editorIsAvailable(editors, preferredEditor))) {
            void openEditor(preferredEditor)
            return
          }
          setMenuOpen(true)
        }}
      >
        <ExternalLink className="size-3.5" />
      </Button>
      <WorkspaceExternalEditorMenu
        open={open}
        editors={editors}
        isLoading={isLoading}
        preferredEditor={preferredEditor}
        preferredLabel={preferredLabel}
        onOpenChange={setMenuOpen}
        onSelectEditor={(editorId) => void openEditor(editorId)}
      />
    </div>
  )
}
