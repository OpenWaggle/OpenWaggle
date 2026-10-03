import { Search, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { RightPanelMaximizeButton } from '@/shared/ui/RightPanelMaximizeButton'
import { useUIStore } from '@/shell/ui-store'
import { useWorkspaceEntryMutations } from '../hooks/useWorkspaceEntryMutations'
import { useWorkspaceFileWatcher } from '../hooks/useWorkspaceFileWatcher'
import { WorkspaceFileBrowser } from './WorkspaceFileBrowser'

interface WorkspaceFileNavigatorPanelProps {
  readonly projectPath: string | null
  /** A previously open file whose folders start expanded; it may no longer exist. */
  readonly revealPath: string | null
  readonly onClose: () => void
  readonly onOpenFile: (path: string, line?: number | null) => void
}

/**
 * Files without a target: only the workspace navigator, used when the Session has no last file
 * or that file no longer exists (ADR 0043).
 */
export function WorkspaceFileNavigatorPanel(input: WorkspaceFileNavigatorPanelProps) {
  const openCommandSurface = useUIStore((state) => state.openCommandSurface)
  const showToast = useUIStore((state) => state.showToast)
  const mutations = useWorkspaceEntryMutations({
    projectPath: input.projectPath,
    relativePath: input.revealPath ?? '',
    onOpenFile: input.onOpenFile,
    onClose: input.onClose,
  })
  useWorkspaceFileWatcher(input.projectPath, mutations.refreshAllWatchedQueries)

  function moveEntry(sourcePath: string, targetPath: string) {
    void mutations
      .move(sourcePath, targetPath)
      .then((moved) => (moved ? mutations.refresh() : undefined))
      .catch((error: unknown) =>
        showToast(error instanceof Error ? error.message : String(error), 'error'),
      )
  }

  return (
    <section
      aria-labelledby="workspace-files-heading"
      className="flex size-full min-h-0 flex-col bg-bg"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <h2
          id="workspace-files-heading"
          tabIndex={-1}
          data-right-sidebar-focus-target="true"
          className="min-w-0 flex-1 text-sm font-medium text-text-primary outline-none"
        >
          Files
        </h2>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => openCommandSurface('files')}
          title="Quick Open"
        >
          <Search className="size-3.5" aria-hidden="true" />
          Open a file
        </Button>
        <RightPanelMaximizeButton />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Close files"
          title="Close files"
          onClick={input.onClose}
        >
          <X className="size-3.5" />
        </Button>
      </header>
      {input.projectPath ? (
        <WorkspaceFileBrowser
          projectPath={input.projectPath}
          currentPath={input.revealPath ?? ''}
          onOpenFile={input.onOpenFile}
          onMoveEntry={moveEntry}
        />
      ) : (
        <p className="p-4 text-sm text-text-tertiary">Open a project first.</p>
      )}
    </section>
  )
}
