import { lazy } from 'react'
import {
  isExtensionRightPanelSurfaceId,
  type RightPanelSurfaceId,
} from '@/shared/lib/right-panel-surfaces'
import { OPEN_A_SESSION_FIRST } from './right-panel-shortcut-handlers'
import { useRightPanelModel } from './useRightPanelModel'

/** Off a Session chat page only these surfaces still have somewhere to open. */
const OPENS_WITHOUT_RIGHT_PANEL: ReadonlySet<RightPanelSurfaceId> = new Set([
  'changes',
  'session-tree',
])
const NOT_AVAILABLE_HERE = 'Not available in this session'

const LazyGlobalCommandPalette = lazy(() =>
  import('@/features/command-palette/components/GlobalCommandPalette').then((module) => ({
    default: module.GlobalCommandPalette,
  })),
)

/** The command palette with each panel's reason it cannot open here (ADR 0043). */
export function RightPanelCommandPalette({ chatRoute }: { readonly chatRoute: boolean }) {
  const model = useRightPanelModel(chatRoute)
  const disabledReason = (id: RightPanelSurfaceId) => {
    if (chatRoute) {
      const surface = model.surfaces.find((entry) => entry.id === id)
      return surface === undefined ? NOT_AVAILABLE_HERE : surface.disabledReason
    }
    if (isExtensionRightPanelSurfaceId(id) || OPENS_WITHOUT_RIGHT_PANEL.has(id)) return null
    return OPEN_A_SESSION_FIRST
  }
  return <LazyGlobalCommandPalette panelDisabledReason={disabledReason} />
}
