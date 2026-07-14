import { createFileRoute } from '@tanstack/react-router'
import { ExtensionRouteView } from '@/features/extensions'

export const Route = createFileRoute('/extensions/$extensionId/$')({
  component: ExtensionRouteView,
})
