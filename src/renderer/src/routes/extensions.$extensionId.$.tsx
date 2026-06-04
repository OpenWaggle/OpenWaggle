import { createFileRoute } from '@tanstack/react-router'
import { ExtensionRouteSurface } from '@/features/extensions'

export const Route = createFileRoute('/extensions/$extensionId/$')({
  component: ExtensionRouteView,
})

function ExtensionRouteView() {
  const { extensionId, _splat } = Route.useParams()

  return <ExtensionRouteSurface extensionId={extensionId} routeId={_splat ?? ''} />
}
