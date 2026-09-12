import { lazy, Suspense } from 'react'
import type { TerminalOwnerContext } from '@/features/terminal'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useUIStore } from './ui-store'
import {
  type BrowserPreviewTabState,
  useWorkspacePanelStore,
  type WorkspacePanelSurface,
} from './workspace-panel-store'

const LazyTerminalPanel = lazy(() =>
  import('@/features/terminal/components').then((module) => ({
    default: module.TerminalPanel,
  })),
)
const LazyBrowserPreviewPanel = lazy(() =>
  import('@/features/browser-preview').then((module) => ({
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
              onMaterialize={(url, profileId) =>
                useWorkspacePanelStore
                  .getState()
                  .materializeBrowser(props.owner.ownerKey, activeBrowser.id, url, profileId)
              }
              onUpdate={(patch) => updateBrowser(props.owner.ownerKey, activeBrowser.id, patch)}
            />
          </Suspense>
        </PanelErrorBoundary>
      ) : null}
    </div>
  )
}
