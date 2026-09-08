import { ModalDialog } from '@/shared/ui/ModalDialog'
import {
  SessionResourceViewerCatalogState,
  VIEWER_DIALOG_CLASS,
} from './SessionResourceViewerChrome'
import { SessionResourceViewerContent } from './SessionResourceViewerContent'
import { SessionResourceViewerHeader } from './SessionResourceViewerHeader'
import { SessionResourceViewerNavigation } from './SessionResourceViewerNavigation'
import { useSessionResourceViewerController } from './useSessionResourceViewerController'

const EMPTY_MESSAGE_IDS: ReadonlySet<string> = new Set()

function viewerCatalogIsLoading(catalogLoading: boolean, locationLoading: boolean) {
  return catalogLoading || locationLoading
}

function displayedPathNodeIds(pathNodeIds: readonly string[] | undefined) {
  return pathNodeIds ?? []
}

export function SessionResourceViewer({
  activeSessionId,
  activeBranchId = null,
  activeMessageIds = EMPTY_MESSAGE_IDS,
  activePathNodeIds,
}: {
  readonly activeSessionId: string | null
  readonly activeBranchId?: string | null
  readonly activeMessageIds?: ReadonlySet<string>
  readonly activePathNodeIds?: readonly string[]
}) {
  const pathNodeIds = displayedPathNodeIds(activePathNodeIds)
  const controller = useSessionResourceViewerController(
    activeSessionId,
    activeBranchId,
    activeMessageIds,
    pathNodeIds,
  )
  const { viewer, viewerSessionId, resource } = controller
  if (!viewer || viewerSessionId !== activeSessionId) return null
  if (!resource) {
    return (
      <SessionResourceViewerCatalogState
        loading={viewerCatalogIsLoading(
          controller.catalog.isLoading,
          controller.imageLocation.isLoading,
        )}
        errorMessage={
          controller.catalog.error?.message ?? controller.imageLocation.error?.message ?? null
        }
        onRetry={() => {
          void controller.catalog.refetch()
          void controller.imageLocation.refetch()
        }}
        onClose={controller.close}
      />
    )
  }

  const navigate = (resourceId: string) => controller.open(viewer.sessionId, resourceId)
  const headerProps = {
    resource,
    index:
      controller.imageLocation.data?.index ?? (controller.targetIsLoaded ? controller.index : null),
    count: controller.imageLocation.data?.total ?? controller.catalog.total,
    zoom: controller.zoom,
    source: controller.source.source,
    downloadUrl: controller.source.downloadUrl,
    branchNames: controller.branchNames,
    activePathNodeIds: new Set(pathNodeIds),
    onZoomChange: controller.changeZoom,
    copying: controller.actions.copying,
    addingToChat: controller.actions.addingToChat,
    onCopy: () => void controller.actions.copy(),
    onAddToChat: () => void controller.actions.addToChat(),
    onClose: controller.close,
  }

  return (
    <ModalDialog
      label={`Image viewer: ${resource.title}`}
      onClose={controller.close}
      className={VIEWER_DIALOG_CLASS}
    >
      <div className="flex h-full min-h-0 flex-col">
        <SessionResourceViewerHeader {...headerProps} />
        <SessionResourceViewerNavigation
          previousResourceId={controller.previousResourceId}
          nextResourceId={controller.nextResourceId}
          onNavigate={navigate}
        />
        <SessionResourceViewerContent
          resource={resource}
          zoom={controller.zoom}
          canvasRef={controller.centeredZoom.viewportRef}
          onZoomChange={controller.changeZoom}
          model={controller.source}
        />
      </div>
    </ModalDialog>
  )
}
