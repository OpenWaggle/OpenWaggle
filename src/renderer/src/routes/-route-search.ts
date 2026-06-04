import { isMatching, P } from '@diegogbrisa/ts-match'
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL, SETTINGS_TABS, type SettingsTab } from '@/shell/ui-store'

export type ChatBuiltInRightPanel = 'diff' | 'session-tree'
export type ChatRightPanel = ChatBuiltInRightPanel | typeof EXTENSION_SIDE_PANEL_ROUTE_PANEL

export interface ChatExtensionSidePanelTarget {
  readonly extensionId: string
  readonly sidePanelId: string
}

export interface ChatRouteSearch {
  readonly branch?: string
  readonly node?: string
  readonly diff?: 1
  readonly panel?: ChatRightPanel
  readonly sidePanelExtensionId?: string
  readonly sidePanelId?: string
}

export interface ChatBuiltInRouteSearch extends ChatRouteSearch {
  readonly panel?: ChatBuiltInRightPanel
  readonly sidePanelExtensionId?: undefined
  readonly sidePanelId?: undefined
}

export interface ChatExtensionSidePanelRouteSearch extends ChatRouteSearch {
  readonly panel: typeof EXTENSION_SIDE_PANEL_ROUTE_PANEL
  readonly sidePanelExtensionId: string
  readonly sidePanelId: string
}

function parseSearchString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function parseSearchToken(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseRightPanel(value: unknown) {
  return isMatching(P.union('diff', 'session-tree', EXTENSION_SIDE_PANEL_ROUTE_PANEL), value)
    ? value
    : undefined
}

export function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  const branch = parseSearchString(search.branch)
  const node = parseSearchString(search.node)
  const panel = parseRightPanel(search.panel)
  const base: ChatRouteSearch = {
    ...(branch ? { branch } : {}),
    ...(node ? { node } : {}),
    ...(search.diff === 1 || search.diff === '1' ? { diff: 1 } : {}),
  }

  if (panel === EXTENSION_SIDE_PANEL_ROUTE_PANEL) {
    const sidePanelExtensionId = parseSearchToken(search.sidePanelExtensionId)
    const sidePanelId = parseSearchToken(search.sidePanelId)

    if (sidePanelExtensionId && sidePanelId) {
      return {
        ...base,
        panel,
        sidePanelExtensionId,
        sidePanelId,
      }
    }

    return base
  }

  return {
    ...base,
    ...(panel ? { panel } : {}),
  }
}

export function extensionSidePanelTargetFromSearch(
  search: ChatRouteSearch,
): ChatExtensionSidePanelTarget | null {
  if (
    search.panel !== EXTENSION_SIDE_PANEL_ROUTE_PANEL ||
    !search.sidePanelExtensionId ||
    !search.sidePanelId
  ) {
    return null
  }

  return {
    extensionId: search.sidePanelExtensionId,
    sidePanelId: search.sidePanelId,
  }
}

export function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab === value)
}
