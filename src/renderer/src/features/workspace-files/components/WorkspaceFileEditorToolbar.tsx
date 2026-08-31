import {
  WORKSPACE_TEXT_ENCODINGS,
  type WorkspaceTextEncoding,
  type WorkspaceTextFileReadResult,
} from '@shared/types/workspace-files'
import { Check, ChevronDown, Code2, Eye, Pencil, RotateCcw, Save, WrapText } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import type { SaveStatus } from '../hooks/useWorkspaceFileEditing'
import { WorkspaceLanguageMenu } from './WorkspaceLanguageMenu'

export function workspaceEncodingLabel(encoding: WorkspaceTextEncoding) {
  if (encoding === 'utf-8-bom') return 'UTF-8 with BOM'
  return encoding.toUpperCase()
}

function saveStatusLabel(status: SaveStatus) {
  if (status === 'saving') return 'Saving…'
  if (status === 'dirty') return 'Unsaved'
  if (status === 'conflict') return 'Changed on disk'
  if (status === 'error') return 'Save failed'
  return 'Saved'
}

function EncodingMenu({
  encoding,
  onReopen,
  onSave,
}: {
  readonly encoding: WorkspaceTextEncoding
  readonly onReopen: (encoding: WorkspaceTextEncoding) => void
  readonly onSave: (encoding: WorkspaceTextEncoding) => void
}) {
  const [open, setOpen] = useState(false)
  const items = (action: 'reopen' | 'save') =>
    WORKSPACE_TEXT_ENCODINGS.map((entry) => (
      <Button
        key={`${action}:${entry}`}
        variant="unstyled"
        role="menuitem"
        className="flex h-7 w-full items-center rounded px-2 text-xs text-text-secondary hover:bg-bg-hover"
        onClick={() => {
          setOpen(false)
          if (action === 'reopen') onReopen(entry)
          else onSave(entry)
        }}
      >
        {workspaceEncodingLabel(entry)}
      </Button>
    ))
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="top-start"
      role="menu"
      className="w-56 p-1"
      trigger={({ toggle }) => (
        <Button variant="unstyled" className="flex items-center gap-1" onClick={toggle}>
          {workspaceEncodingLabel(encoding)} <ChevronDown className="size-3" />
        </Button>
      )}
    >
      <p className="px-2 py-1 text-xs font-medium text-text-muted">Reopen with Encoding</p>
      {items('reopen')}
      <div className="my-1 border-t border-border" />
      <p className="px-2 py-1 text-xs font-medium text-text-muted">Save with Encoding</p>
      {items('save')}
    </Popover>
  )
}

interface EditorToolbarState {
  readonly status: SaveStatus
  readonly errorMessage: string | null
  readonly wordWrap: boolean
  readonly canPreview: boolean
  readonly preview: boolean
  readonly language: string
  readonly encoding: WorkspaceTextEncoding
  readonly lineEnding: WorkspaceTextFileReadResult['fidelity']['lineEnding']
  readonly focusedEdit: boolean
}

interface EditorToolbarActions {
  readonly onReload: () => void
  readonly onCompare: () => void
  readonly onRestoreDraft: () => void
  readonly onRetry: () => void
  readonly onToggleWrap: () => void
  readonly onTogglePreview: () => void
  readonly onLanguageChange: (language: string) => void
  readonly onAssociateLanguagePattern: () => void
  readonly onReopenEncoding: (encoding: WorkspaceTextEncoding) => void
  readonly onSaveEncoding: (encoding: WorkspaceTextEncoding) => void
  readonly onBeginEdit: () => void
  readonly onFinishEdit: () => void
}

function SaveRecoveryActions({
  state,
  actions,
}: {
  readonly state: EditorToolbarState
  readonly actions: EditorToolbarActions
}) {
  if (state.status === 'conflict') {
    return (
      <>
        <Button variant="ghost" size="xs" onClick={actions.onCompare}>
          Compare
        </Button>
        <Button variant="ghost" size="xs" onClick={actions.onRestoreDraft}>
          Keep Draft
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={actions.onReload}
          leftIcon={<RotateCcw className="size-3" />}
        >
          Use Disk
        </Button>
      </>
    )
  }
  if (state.status !== 'error') return null
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={actions.onRetry}
      leftIcon={<Save className="size-3" />}
    >
      Retry
    </Button>
  )
}

export function WorkspaceFileEditorToolbar({
  state,
  actions,
  file,
}: {
  readonly state: EditorToolbarState
  readonly actions: EditorToolbarActions
  readonly file: WorkspaceTextFileReadResult
}) {
  return (
    <div className="flex h-9 min-w-0 shrink-0 items-center overflow-hidden border-b border-border px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-text-muted">
        {state.focusedEdit ? <Save className="size-3" /> : null}
        {state.focusedEdit ? (
          <>
            <span
              className={
                state.status === 'conflict' || state.status === 'error' ? 'text-error' : undefined
              }
              title={state.errorMessage ?? undefined}
            >
              {saveStatusLabel(state.status)}
            </span>
            <span aria-hidden="true">·</span>
            <EncodingMenu
              encoding={state.encoding}
              onReopen={actions.onReopenEncoding}
              onSave={actions.onSaveEncoding}
            />
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        <span>{state.lineEnding.toUpperCase()}</span>
        <span aria-hidden="true">·</span>
        <span>
          {file.fidelity.indentStyle === 'tab'
            ? `Tabs: ${String(file.fidelity.indentSize)}`
            : `Spaces: ${String(file.fidelity.indentSize)}`}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <WorkspaceLanguageMenu
          language={state.language}
          filePath={file.path}
          compact
          onChange={actions.onLanguageChange}
          onAssociatePattern={actions.onAssociateLanguagePattern}
        />
        <SaveRecoveryActions state={state} actions={actions} />
        <Button
          variant={state.wordWrap ? 'accent' : 'ghost'}
          size="icon-sm"
          title="Toggle word wrap"
          aria-label="Toggle word wrap"
          onClick={actions.onToggleWrap}
        >
          <WrapText className="size-3.5" />
        </Button>
        {state.canPreview ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={actions.onTogglePreview}
            leftIcon={state.preview ? <Code2 className="size-3" /> : <Eye className="size-3" />}
          >
            {state.preview ? 'Edit' : 'Preview'}
          </Button>
        ) : null}
        <Button
          variant={state.focusedEdit ? 'ghost' : 'accent'}
          size="xs"
          onClick={state.focusedEdit ? actions.onFinishEdit : actions.onBeginEdit}
          leftIcon={
            state.focusedEdit ? <Check className="size-3" /> : <Pencil className="size-3" />
          }
        >
          {state.focusedEdit ? 'Done' : 'Edit'}
        </Button>
      </div>
    </div>
  )
}
