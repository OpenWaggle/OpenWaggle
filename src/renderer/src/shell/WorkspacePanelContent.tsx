import { lazy, Suspense } from 'react'
import type { TerminalOwnerContext } from '@/features/terminal'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useUIStore } from './ui-store'
import {
  type BrowserPreviewTabState,
  useWorkspacePanelStore,
  type WorkspacePanelSurface,
} from './workspace-panel-store'

// Every surface below renders only once the Right panel shows it, so none is in the eager shell
// graph (renderer-load B8; scripts/check-syntax-bundle.ts budgets the initial graph).
const LazyAllPanelsSurface = lazy(() =>
  import('./right-panel/AllPanelsSurface').then((module) => ({
    default: module.AllPanelsSurface,
  })),
)
const LazyWorkspaceProjectActionsSurface = lazy(() =>
  import('./right-panel/WorkspaceProjectActionsSurface').then((module) => ({
    default: module.WorkspaceProjectActionsSurface,
  })),
)
const LazyWorkspaceScheduledTasksSurface = lazy(() =>
  import('./right-panel/WorkspaceScheduledTasksSurface').then((module) => ({
    default: module.WorkspaceScheduledTasksSurface,
  })),
)
const LazyActionRunPanel = lazy(() =>
  import('@/features/project-actions/components').then((module) => ({
    default: module.ActionRunPanel,
  })),
)
const LazyTerminalPanel = lazy(() =>
  import('@/features/terminal/components').then((module) => ({
    default: module.TerminalPanel,
  })),
)
const LazyBrowserPreviewPanel = lazy(() =>
  import('@/features/browser-preview/components').then((module) => ({
    default: module.BrowserPreviewPanel,
  })),
)

interface WorkspacePanelContentProps {
  readonly activeBrowser: BrowserPreviewTabState | null
  readonly activeSurface: WorkspacePanelSurface
  readonly onCloseBrowser: (previewId: string) => void
  readonly onReturnToDrawer: () => void
  readonly owner: TerminalOwnerContext
  readonly sidePanelKey: string
}

export function WorkspacePanelContent(props: WorkspacePanelContentProps) {
  const updateBrowser = useWorkspacePanelStore((state) => state.updateBrowser)
  const showToast = useUIStore((state) => state.showToast)
  if (props.activeSurface?.kind === 'all-panels') {
    return (
      <Suspense fallback={null}>
        <LazyAllPanelsSurface />
      </Suspense>
    )
  }
  if (props.activeSurface?.kind === 'project-actions') {
    return (
      <Suspense fallback={null}>
        <LazyWorkspaceProjectActionsSurface owner={props.owner} />
      </Suspense>
    )
  }
  if (props.activeSurface?.kind === 'scheduled-tasks') {
    return (
      <Suspense fallback={null}>
        <LazyWorkspaceScheduledTasksSurface />
      </Suspense>
    )
  }
  if (props.activeSurface?.kind === 'action')
    return (
      <Suspense fallback={null}>
        <LazyActionRunPanel
          key={`${props.owner.ownerKey}:${props.activeSurface.runId}`}
          scope={{ projectPath: props.activeSurface.projectPath, sessionId: props.owner.ownerKey }}
          runId={props.activeSurface.runId}
        />
      </Suspense>
    )
  if (props.activeSurface?.kind === 'terminal') {
    return (
      <div className="min-h-0 flex-1">
        <PanelErrorBoundary name="Terminal side panel" className="size-full">
          <Suspense fallback={null}>
            <LazyTerminalPanel
              ownerKey={props.sidePanelKey}
              runtimeOwnerKey={props.owner.ownerKey}
              defaultCwd={props.owner.defaultCwd}
              defaultProvenance={props.owner.defaultProvenance}
              closePanelLabel="Return terminals to bottom"
              onClose={props.onReturnToDrawer}
            />
          </Suspense>
        </PanelErrorBoundary>
      </div>
    )
  }
  const activeBrowser = props.activeBrowser
  return (
    <div className="min-h-0 flex-1">
      {activeBrowser !== null ? (
        <PanelErrorBoundary name="Browser preview" className="size-full">
          <Suspense fallback={null}>
            <LazyBrowserPreviewPanel
              key={activeBrowser.id}
              tab={activeBrowser}
              onClose={() => props.onCloseBrowser(activeBrowser.id)}
              onError={(message) => showToast(message, 'error')}
              onFloat={() => useWorkspacePanelStore.getState().hidePanel(props.owner.ownerKey)}
              onMaterialize={(url, profileId) => {
                try {
                  useWorkspacePanelStore
                    .getState()
                    .materializeBrowser(props.owner.ownerKey, activeBrowser.id, url, profileId)
                } catch (error) {
                  showToast(
                    error instanceof Error ? error.message : 'Browser tab could not open.',
                    'error',
                  )
                }
              }}
              onUpdate={(patch) => updateBrowser(props.owner.ownerKey, activeBrowser.id, patch)}
            />
          </Suspense>
        </PanelErrorBoundary>
      ) : null}
    </div>
  )
}
