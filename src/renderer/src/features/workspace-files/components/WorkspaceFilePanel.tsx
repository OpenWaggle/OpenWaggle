import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import { useWorkspaceEntryMutations } from '../hooks/useWorkspaceEntryMutations'
import { useWorkspaceFileNavigation } from '../hooks/useWorkspaceFileNavigation'
import { useWorkspaceFileWatcher } from '../hooks/useWorkspaceFileWatcher'
import { WorkspaceFileBrowser } from './WorkspaceFileBrowser'
import { GoToLineDialog, WorkspaceMutationDialog } from './WorkspaceFileDialogs'
import { WorkspaceFilePanelHeader } from './WorkspaceFilePanelHeader'
import { WorkspaceFilePane } from './WorkspaceFilePreview'

interface WorkspaceFilePanelProps {
  readonly projectPath: string | null
  readonly relativePath: string
  readonly line: number | null
  readonly onClose: () => void
  readonly onOpenFile: (path: string, line?: number | null) => void
}

function WorkspaceFilePanelBody({
  state,
  actions,
}: {
  readonly state: {
    readonly explorerOpen: boolean
    readonly projectPath: string | null
    readonly relativePath: string
    readonly line: number | null
  }
  readonly actions: {
    readonly onOpenFile: (path: string, line?: number | null) => void
    readonly onMoveEntry: (sourcePath: string, targetPath: string) => void
  }
}) {
  return (
    <div className="flex min-h-0 flex-1">
      {state.explorerOpen && state.projectPath ? (
        <WorkspaceFileBrowser
          projectPath={state.projectPath}
          currentPath={state.relativePath}
          onOpenFile={actions.onOpenFile}
          onMoveEntry={actions.onMoveEntry}
        />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkspaceFilePane
            projectPath={state.projectPath}
            relativePath={state.relativePath}
            line={state.line}
          />
        </div>
      </div>
    </div>
  )
}

export function WorkspaceFilePanel(input: WorkspaceFilePanelProps) {
  const navigation = useWorkspaceFileNavigation(input)
  const mutations = useWorkspaceEntryMutations({
    projectPath: input.projectPath,
    relativePath: input.relativePath,
    onOpenFile: input.onOpenFile,
    onClose: input.onClose,
  })
  useWorkspaceFileWatcher(input.projectPath, mutations.refreshAllWatchedQueries)
  const showToast = useUIStore((state) => state.showToast)

  function moveEntry(sourcePath: string, targetPath: string) {
    void mutations
      .move(sourcePath, targetPath)
      .then((moved) => (moved ? mutations.refresh() : undefined))
      .catch((error: unknown) =>
        showToast(error instanceof Error ? error.message : String(error), 'error'),
      )
  }

  function openExternal() {
    if (!input.projectPath) return
    void api.openWorkspaceFileExternal(input.projectPath, input.relativePath).catch((error) => {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    })
  }

  function openGoToLine() {
    navigation.setGoToLineValue(input.line ? String(input.line) : '')
    navigation.setGoToLineOpen(true)
  }

  return (
    <div className="flex size-full min-h-0 flex-col bg-bg">
      <WorkspaceFilePanelHeader
        state={{
          projectPath: input.projectPath,
          relativePath: input.relativePath,
          line: input.line,
          explorerOpen: navigation.explorerOpen,
        }}
        actions={{
          onToggleExplorer: () => navigation.setExplorerOpen((current) => !current),
          onOpenExternal: openExternal,
          onGoToLine: openGoToLine,
          onBeginMutation: mutations.begin,
          onCopyRelativePath: () => void navigator.clipboard.writeText(input.relativePath),
          onReveal: () => {
            if (input.projectPath)
              void api.revealWorkspaceEntry(input.projectPath, input.relativePath)
          },
          onClose: input.onClose,
        }}
      />
      <WorkspaceMutationDialog
        state={{
          action: mutations.action,
          path: mutations.path,
          relativePath: input.relativePath,
        }}
        actions={{
          onPathChange: mutations.setPath,
          onApply: () => void mutations.apply(),
          onClose: mutations.close,
        }}
      />
      <GoToLineDialog
        open={navigation.goToLineOpen}
        value={navigation.goToLineValue}
        onValueChange={navigation.setGoToLineValue}
        onApply={navigation.goToLine}
        onClose={() => navigation.setGoToLineOpen(false)}
      />
      <WorkspaceFilePanelBody
        state={{
          explorerOpen: navigation.explorerOpen,
          projectPath: input.projectPath,
          relativePath: input.relativePath,
          line: input.line,
        }}
        actions={{ onOpenFile: input.onOpenFile, onMoveEntry: moveEntry }}
      />
    </div>
  )
}
