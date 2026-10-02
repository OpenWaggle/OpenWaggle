import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import type { Settings } from '@shared/types/settings'
import { PanelRight } from 'lucide-react'
import type { ExtensionSidePanelSurfaceEntry } from '@/features/extensions'
import { rightPanelSurfaceShortcut } from '@/features/settings'
import { BUILT_IN_RIGHT_PANEL_SURFACES } from '@/shared/lib/right-panel-catalog'
import {
  hasRightPanelController,
  type RightPanelSurfaceId,
  showRightPanelSurface,
} from '@/shared/lib/right-panel-surfaces'
import { COMMAND_PALETTE } from '../constants/command-palette'
import type { CommandPaletteItem } from '../model'
import { truncateCommandDescription } from './command-palette-text'

const PANELS_SECTION = 'Panels'

/**
 * Why a surface cannot be shown right now, or null when it can. The shell's Right panel owner
 * supplies the real reasons (ADR 0043); without one every surface is offered.
 */
export type RightPanelSurfaceDisabledReason = (id: RightPanelSurfaceId) => string | null

const noDisabledReason: RightPanelSurfaceDisabledReason = () => null

interface PanelCommandItemsInput {
  readonly settings: Pick<Settings, 'shortcutBindings' | 'extensionPanelShortcutBindings'>
  /** Extension side panels that can be shown now, one per surface. */
  readonly extensionPanels: readonly ExtensionSidePanelSurfaceEntry[]
  readonly showSurface: (id: RightPanelSurfaceId, panel?: ExtensionSidePanelSurfaceEntry) => void
  readonly disabledReason?: RightPanelSurfaceDisabledReason
}

function panelItem(
  input: PanelCommandItemsInput,
  item: Omit<CommandPaletteItem, 'action' | 'disabled' | 'section' | 'trailing'> & {
    readonly surfaceId: RightPanelSurfaceId
    readonly panel?: ExtensionSidePanelSurfaceEntry
  },
): CommandPaletteItem {
  const { surfaceId, panel, ...rest } = item
  const reason = (input.disabledReason ?? noDisabledReason)(surfaceId)
  const shortcut = rightPanelSurfaceShortcut(input.settings, surfaceId)
  return {
    ...rest,
    ...(reason === null ? {} : { description: reason, disabled: true }),
    section: PANELS_SECTION,
    ...(shortcut.label === null ? {} : { trailing: shortcut.label }),
    action: () => {
      if (reason === null) input.showSurface(surfaceId, panel)
    },
  }
}

/**
 * One entry per Right panel surface: built-ins in rail order, then extension side panels. Choosing
 * one shows that surface and never closes the Right panel.
 */
export function createPanelCommandItems(input: PanelCommandItemsInput): CommandPaletteItem[] {
  const builtIns = BUILT_IN_RIGHT_PANEL_SURFACES.map((surface) => {
    const Icon = surface.icon
    return panelItem(input, {
      id: `panel:${surface.id}`,
      surfaceId: surface.id,
      label: surface.title,
      description: surface.description,
      icon: <Icon className="size-3.5" />,
    })
  })
  const extensions = input.extensionPanels.map((panel) =>
    panelItem(input, {
      id: `panel:${panel.surfaceId}`,
      surfaceId: panel.surfaceId,
      panel,
      label: panel.entry.title,
      description: truncateCommandDescription(
        panel.entry.extensionName,
        COMMAND_PALETTE.DESCRIPTION_LIMIT,
      ),
      icon: <PanelRight className="size-3.5" />,
      trailingBadge: panel.entry.scope.label,
    }),
  )
  return [...builtIns, ...extensions]
}

interface LegacyPanelOpeners {
  readonly openBuiltInPanel: (panel: 'diff' | 'session-tree') => void
  readonly openExtensionPanel: (entry: ExtensionContributionRegistryEntry) => void
}

/**
 * Shows a surface through the Right panel controller. Until the shell registers one, the panels
 * that already had a palette entry keep opening through their route.
 */
export function showPanelSurface(
  id: RightPanelSurfaceId,
  panel: ExtensionSidePanelSurfaceEntry | undefined,
  legacy: LegacyPanelOpeners,
) {
  if (hasRightPanelController()) {
    showRightPanelSurface(id)
    return
  }
  if (id === 'changes') {
    legacy.openBuiltInPanel('diff')
    return
  }
  if (id === 'session-tree') {
    legacy.openBuiltInPanel('session-tree')
    return
  }
  if (panel !== undefined) legacy.openExtensionPanel(panel.entry)
}
