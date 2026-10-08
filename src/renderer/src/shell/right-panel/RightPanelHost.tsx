import { useEffect, useEffectEvent } from 'react'
import { useGit } from '@/features/git/hooks'
import { ProjectActionsBackgroundEffects } from '@/features/project-actions'
import { usePreferencesStore } from '@/features/settings/state'
import { RIGHT_PANEL_RAIL_INSET_VAR } from '@/shared/ui/right-sidebar-layout-sizing'
import { PANEL_RAIL_WIDTH_PX, PanelRail } from './PanelRail'
import { useRightPanelRailStore } from './right-panel-rail-store'
import { useRightPanelController } from './useRightPanelController'
import { useRightPanelModel } from './useRightPanelModel'

/**
 * Owns the Right panel for chat routes: registers the surface controller, keeps Session panel
 * memory and renders the Panel rail on the window's right edge (ADR 0043).
 */
export function RightPanelHost() {
  const model = useRightPanelModel()
  const git = useGit()
  const controller = useRightPanelController(model, git.workingPath ?? model.projectPath)
  const railVisibleWhenClosed = usePreferencesStore(
    (state) => state.settings.rightPanelRailVisibleWhenClosed,
  )
  const extensionKey = model.extensionPanels.map((panel) => panel.id).join('\n')
  // The first listing is not "new": panels installed before the rail existed stay quiet.
  const initializeExtensions = useEffectEvent((_key: string) => {
    useRightPanelRailStore
      .getState()
      .initializeExtensions(model.extensionPanels.map((panel) => panel.id))
  })
  useEffect(() => {
    if (model.extensionRegistryLoaded) initializeExtensions(extensionKey)
  }, [extensionKey, model.extensionRegistryLoaded])

  const railShown = model.shown.open || railVisibleWhenClosed
  useEffect(() => {
    if (!railShown) return
    const root = document.documentElement
    root.style.setProperty(RIGHT_PANEL_RAIL_INSET_VAR, `${String(PANEL_RAIL_WIDTH_PX)}px`)
    return () => {
      root.style.removeProperty(RIGHT_PANEL_RAIL_INSET_VAR)
    }
  }, [railShown])

  const effects = <ProjectActionsBackgroundEffects />
  if (!railShown) return effects
  return (
    <>
      {effects}
      <PanelRail
        model={model}
        actions={{
          toggleSurface: controller.toggleSurface,
          showSurface: controller.showSurface,
          move: (id, move) =>
            useRightPanelRailStore
              .getState()
              .move(id, move, model.knownRailIds, model.listedRailIds),
          unpin: (id) => useRightPanelRailStore.getState().setPinned(id, false),
          reset: () => useRightPanelRailStore.getState().reset(),
        }}
      />
    </>
  )
}
