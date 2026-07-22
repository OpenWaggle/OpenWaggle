import { useParams } from '@tanstack/react-router'
import { ExtensionRouteSurface } from './ExtensionRouteSurface'

export function ExtensionRouteView() {
  const { extensionId, _splat } = useParams({ from: '/extensions/$extensionId/$' })

  return <ExtensionRouteSurface extensionId={extensionId} routeId={_splat ?? ''} />
}
