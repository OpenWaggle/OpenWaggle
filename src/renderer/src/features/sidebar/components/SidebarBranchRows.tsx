import type { SessionBranch } from '@shared/types/session'
import { AlertTriangle, Archive, Edit3, GitBranch, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import { TextInput } from '@/shared/ui/TextInput'
import type { SidebarBranchRow } from '../lib/sidebar-branches'
import type { SidebarBranchActions } from '../model'

interface SidebarBranchRowsProps {
  readonly sessionId: string
  readonly rows: readonly SidebarBranchRow[]
  readonly actions: SidebarBranchActions
}

interface BranchRenameController {
  readonly branchId: string | null
  readonly inputElement: React.RefObject<HTMLInputElement | null>
  readonly value: string
  readonly cancel: () => void
  readonly save: (branch: SessionBranch) => void
  readonly setValue: (value: string) => void
  readonly start: (branch: SessionBranch) => void
}

interface BranchMenuController {
  readonly branchId: string | null
  readonly setBranchId: (branchId: string | null) => void
}

function DraftBranchRow({ sourceNodeId }: { readonly sourceNodeId: string }) {
  return (
    <div className="mx-2 flex h-7 w-[calc(100%-16px)] items-center gap-2 rounded-md border border-dashed border-border pl-11 pr-3 text-left text-text-tertiary">
      <GitBranch className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[12px]">Draft branch from {sourceNodeId}</span>
    </div>
  )
}

function BranchRenameInput({
  branch,
  cancelRename,
  inputElement,
  renameValue,
  saveRename,
  setRenameValue,
}: {
  readonly branch: SessionBranch
  readonly cancelRename: () => void
  readonly inputElement: React.RefObject<HTMLInputElement | null>
  readonly renameValue: string
  readonly saveRename: (branch: SessionBranch) => void
  readonly setRenameValue: (value: string) => void
}) {
  return (
    <TextInput
      ref={inputElement}
      value={renameValue}
      onChange={(event) => setRenameValue(event.target.value)}
      onBlur={() => saveRename(branch)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          saveRename(branch)
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          cancelRename()
        }
      }}
      variant="transparent"
      inputSize="sm"
      className="min-w-0 flex-1 px-0 text-[12px]"
    />
  )
}

function BranchActionsPopover({
  branch,
  isOpen,
  menu,
  rename,
  onArchive,
}: {
  readonly branch: SessionBranch
  readonly isOpen: boolean
  readonly menu: BranchMenuController
  readonly rename: BranchRenameController
  readonly onArchive: () => void
}) {
  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => menu.setBranchId(open ? String(branch.id) : null)}
      placement="bottom-end"
      className="min-w-[132px] py-1"
      trigger={({ isOpen: triggerOpen, toggle }) => (
        <Button
          variant="unstyled"
          type="button"
          aria-label={`Open branch actions for ${branch.name}`}
          aria-expanded={triggerOpen}
          onClick={(event) => {
            event.stopPropagation()
            toggle()
          }}
          className="flex size-5 shrink-0 items-center justify-center rounded text-text-tertiary opacity-0 transition-colors hover:bg-bg-hover hover:text-text-secondary group-hover:opacity-100 focus:opacity-100"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      )}
    >
      {!branch.isMain ? (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => rename.start(branch)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
        >
          <Edit3 className="size-3 shrink-0" />
          <span>Rename</span>
        </Button>
      ) : null}
      <Button
        variant="unstyled"
        type="button"
        onClick={onArchive}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
      >
        <Archive className="size-3 shrink-0" />
        <span>{branch.isMain ? 'Archive session' : 'Archive'}</span>
      </Button>
    </Popover>
  )
}

function SidebarBranchItem({
  sessionId,
  row,
  menu,
  rename,
  actions,
}: {
  readonly sessionId: string
  readonly row: Extract<SidebarBranchRow, { type: 'branch' }>
  readonly menu: BranchMenuController
  readonly rename: BranchRenameController
  readonly actions: SidebarBranchActions
}) {
  const branchId = String(row.branch.id)
  const isRenaming = rename.branchId === branchId

  return (
    <div
      className={cn(
        'group mx-2 flex h-7 w-[calc(100%-16px)] items-center gap-2 rounded-md pl-11 pr-1.5 text-left transition-colors',
        row.isActive
          ? 'bg-bg-active text-text-primary'
          : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary',
      )}
    >
      {row.branch.interruptedRun ? (
        <AlertTriangle className="size-3 shrink-0 text-amber-400" aria-label="Interrupted run" />
      ) : (
        <GitBranch className="size-3 shrink-0" />
      )}
      {isRenaming ? (
        <BranchRenameInput
          branch={row.branch}
          cancelRename={rename.cancel}
          inputElement={rename.inputElement}
          renameValue={rename.value}
          saveRename={rename.save}
          setRenameValue={rename.setValue}
        />
      ) : (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => actions.select(sessionId, row.branch)}
          className="min-w-0 flex-1 truncate text-left text-[12px]"
        >
          {row.branch.name}
        </Button>
      )}
      {!isRenaming ? (
        <BranchActionsPopover
          branch={row.branch}
          isOpen={menu.branchId === branchId}
          menu={menu}
          rename={rename}
          onArchive={() => {
            menu.setBranchId(null)
            actions.archive(sessionId, row.branch)
          }}
        />
      ) : null}
    </div>
  )
}

export function SidebarBranchRows({ sessionId, rows, actions }: SidebarBranchRowsProps) {
  const [renamingBranchId, setRenamingBranchId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [menuBranchId, setMenuBranchId] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!renamingBranchId) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renamingBranchId])

  function cancelRename() {
    setRenamingBranchId(null)
    setRenameValue('')
  }

  const rename: BranchRenameController = {
    branchId: renamingBranchId,
    inputElement: renameInputRef,
    value: renameValue,
    cancel: cancelRename,
    save(branch) {
      const trimmed = renameValue.trim()
      if (trimmed && trimmed !== branch.name) {
        actions.rename(sessionId, branch, trimmed)
      }
      cancelRename()
    },
    setValue: setRenameValue,
    start(branch) {
      setMenuBranchId(null)
      setRenamingBranchId(String(branch.id))
      setRenameValue(branch.name)
    },
  }

  if (rows.length === 0) return null

  return (
    <div className="mb-1 space-y-0.5">
      {rows.map((row) =>
        row.type === 'draft' ? (
          <DraftBranchRow key="draft" sourceNodeId={String(row.sourceNodeId)} />
        ) : (
          <SidebarBranchItem
            key={String(row.branch.id)}
            sessionId={sessionId}
            row={row}
            menu={{ branchId: menuBranchId, setBranchId: setMenuBranchId }}
            rename={rename}
            actions={actions}
          />
        ),
      )}
    </div>
  )
}
