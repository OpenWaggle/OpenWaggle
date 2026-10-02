import { lazy } from 'react'
import type { RightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import { useRightPanelModel } from './useRightPanelModel'

const LazyGlobalCommandPalette = lazy(() =>
  import('@/features/command-palette/components/GlobalCommandPalette').then((module) => ({
    default: module.GlobalCommandPalette,
  })),
)

/** The command palette with each panel's reason it cannot open here (ADR 0043). */
export function RightPanelCommandPalette({ chatRoute }: { readonly chatRoute: boolean }) {
  const model = useRightPanelModel(chatRoute)
  const disabledReason = (id: RightPanelSurfaceId) =>
    chatRoute ? (model.surfaces.find((surface) => surface.id === id)?.disabledReason ?? null) : null
  return <LazyGlobalCommandPalette panelDisabledReason={disabledReason} />
}
