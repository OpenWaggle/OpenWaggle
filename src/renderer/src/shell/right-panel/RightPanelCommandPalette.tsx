import { lazy } from 'react'
import {
  isExtensionRightPanelSurfaceId,
  type RightPanelSurfaceId,
} from '@/shared/lib/right-panel-surfaces'
import { useRightPanelModel } from './useRightPanelModel'

/** Off a Session chat page only these surfaces still have somewhere to open. */
const OPENS_WITHOUT_RIGHT_PANEL: ReadonlySet<RightPanelSurfaceId> = new Set([
  'changes',
  'session-tree',
])
const OPEN_A_SESSION_FIRST = 'Open a session first'

const LazyGlobalCommandPalette = lazy(() =>
  import('@/features/command-palette/components/GlobalCommandPalette').then((module) => ({
    default: module.GlobalCommandPalette,
  })),
)

/** The command palette with each panel's reason it cannot open here (ADR 0043). */
export function RightPanelCommandPalette({ chatRoute }: { readonly chatRoute: boolean }) {
  const model = useRightPanelModel(chatRoute)
  const disabledReason = (id: RightPanelSurfaceId) => {
    if (chatRoute)
      return model.surfaces.find((surface) => surface.id === id)?.disabledReason ?? null
    if (isExtensionRightPanelSurfaceId(id) || OPENS_WITHOUT_RIGHT_PANEL.has(id)) return null
    return OPEN_A_SESSION_FIRST
  }
  return <LazyGlobalCommandPalette panelDisabledReason={disabledReason} />
}
