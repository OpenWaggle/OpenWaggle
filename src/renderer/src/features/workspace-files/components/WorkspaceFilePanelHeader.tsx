import {
  Copy,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  FolderTree,
  ListOrdered,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
import type { WorkspaceMutationAction } from '../lib/workspace-file-layout'

const WORKSPACE_MUTATION_ITEMS = [
  { label: 'New file…', icon: FilePlus2, action: 'create-file' },
  { label: 'New folder…', icon: FolderPlus, action: 'create-directory' },
  { label: 'Rename or move…', icon: Pencil, action: 'move' },
  { label: 'Duplicate…', icon: Copy, action: 'duplicate' },
] satisfies readonly {
  readonly label: string
  readonly icon: typeof FilePlus2
  readonly action: WorkspaceMutationAction
}[]

interface HeaderState {
  readonly projectPath: string | null
  readonly relativePath: string
  readonly line: number | null
  readonly workspaceTreeOpen: boolean
}

interface HeaderActions {
  readonly onToggleWorkspaceTree: () => void
  readonly onOpenExternal: () => void
  readonly onGoToLine: () => void
  readonly onBeginMutation: (action: WorkspaceMutationAction) => void
  readonly onCopyRelativePath: () => void
  readonly onReveal: () => void
  readonly onClose: () => void
}

function WorkspaceFileActions({
  state,
  actions,
}: {
  readonly state: HeaderState
  readonly actions: HeaderActions
}) {
  if (!state.projectPath) return null
  return (
    <Popover
      placement="bottom-end"
      role="menu"
      className="w-48 p-1"
      trigger={({ toggle }) => (
        <Button
          variant="ghost"
          size="icon-sm"
          title="File actions"
          aria-label="File actions"
          onClick={toggle}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      )}
    >
      {WORKSPACE_MUTATION_ITEMS.map((item) => (
        <Button
          key={item.action}
          variant="unstyled"
          role="menuitem"
          className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs text-text-secondary hover:bg-bg-hover"
          onClick={() => actions.onBeginMutation(item.action)}
        >
          <item.icon className="size-3.5" />
          {item.label}
        </Button>
      ))}
      <Button
        variant="unstyled"
        role="menuitem"
        className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs text-text-secondary hover:bg-bg-hover"
        onClick={actions.onCopyRelativePath}
      >
        <Copy className="size-3.5" /> Copy relative path
      </Button>
      <Button
        variant="unstyled"
        role="menuitem"
        className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs text-text-secondary hover:bg-bg-hover"
        onClick={actions.onReveal}
      >
        <FolderOpen className="size-3.5" /> Reveal in Finder
      </Button>
      <Button
        variant="unstyled"
        role="menuitem"
        className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs text-error hover:bg-error/10"
        onClick={() => actions.onBeginMutation('trash')}
      >
        <Trash2 className="size-3.5" /> Move to Trash…
      </Button>
    </Popover>
  )
}

export function WorkspaceFilePanelHeader({
  state,
  actions,
}: {
  readonly state: HeaderState
  readonly actions: HeaderActions
}) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-2">
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary"
        title={state.relativePath}
      >
        {state.relativePath}
        {state.line ? <span className="text-accent">:{state.line}</span> : null}
      </span>
      <Button
        variant={state.workspaceTreeOpen ? 'accent' : 'ghost'}
        size="icon-sm"
        aria-label="Toggle workspace navigator"
        aria-pressed={state.workspaceTreeOpen}
        title="Toggle workspace navigator"
        onClick={actions.onToggleWorkspaceTree}
      >
        <FolderTree className="size-3.5" />
      </Button>
      {state.projectPath ? (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Open in external editor"
          aria-label="Open file in external editor"
          onClick={actions.onOpenExternal}
        >
          <ExternalLink className="size-3.5" />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        title="Go to line (Cmd/Ctrl+G)"
        aria-label="Go to line"
        onClick={actions.onGoToLine}
      >
        <ListOrdered className="size-3.5" />
      </Button>
      <WorkspaceFileActions state={state} actions={actions} />
      <Button
        variant="ghost"
        size="icon-sm"
        title="Close file panel"
        aria-label="Close file panel"
        onClick={actions.onClose}
      >
        <X className="size-3.5" />
      </Button>
    </header>
  )
}
