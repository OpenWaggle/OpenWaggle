import { isMatching, P } from '@diegogbrisa/ts-match'
import type { UncheckedFields } from '@shared/types/unchecked-fields'
import type { SessionResourceBrowserTarget } from '@/features/session-summary'
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL, SETTINGS_TABS, type SettingsTab } from '@/shell/ui-store'

export type ChatBuiltInRightPanel =
  | 'change-request'
  | 'diff'
  | 'file'
  | 'resources'
  | 'session-tree'
  | 'hive'
export type ChatRightPanel = ChatBuiltInRightPanel | typeof EXTENSION_SIDE_PANEL_ROUTE_PANEL
export interface ChatExtensionSidePanelTarget {
  readonly extensionId: string
  readonly sidePanelId: string
  readonly packagePath?: string
  readonly contentHash?: string
}

/** The router's raw search values, by the names ChatRouteSearch declares, each still unchecked. */
type RawChatSearch = UncheckedFields<ChatRouteSearch>

export interface ChatRouteSearch {
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly branch?: string | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly node?: string | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly diff?: 1 | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly panel?: ChatRightPanel | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly filePath?: string | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly fileLine?: number | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly resourceView?: 'sources' | 'outputs' | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly resourceId?: string | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly sidePanelExtensionId?: string | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly sidePanelId?: string | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly sidePanelPackagePath?: string | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly sidePanelContentHash?: string | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly changeRequestUrl?: string | undefined
  // explicit undefined: a TanStack Router search update clears this param with undefined
  readonly changeRequestSessionId?: string | undefined
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
  return isMatching(
    P.union(
      'change-request',
      'diff',
      'file',
      'resources',
      'session-tree',
      'hive',
      EXTENSION_SIDE_PANEL_ROUTE_PANEL,
    ),
    value,
  )
    ? value
    : undefined
}

function parseFileLine(value: unknown) {
  const numericValue = typeof value === 'string' ? Number(value) : value
  return typeof numericValue === 'number' && Number.isSafeInteger(numericValue) && numericValue > 0
    ? numericValue
    : undefined
}

function parseResourceView(value: unknown) {
  return isMatching(P.union('sources', 'outputs'), value) ? value : undefined
}

function parseBaseChatSearch(search: RawChatSearch) {
  const branch = parseSearchString(search.branch)
  const node = parseSearchString(search.node)
  const result: ChatRouteSearch = {
    ...(branch ? { branch } : {}),
    ...(node ? { node } : {}),
    ...(search.diff === 1 || search.diff === '1' ? { diff: 1 } : {}),
  }
  return result
}

function parseExtensionPanelSearch(search: RawChatSearch, base: ChatRouteSearch) {
  const sidePanelExtensionId = parseSearchToken(search.sidePanelExtensionId)
  const sidePanelId = parseSearchToken(search.sidePanelId)
  if (!sidePanelExtensionId || !sidePanelId) return base

  const sidePanelPackagePath = parseSearchToken(search.sidePanelPackagePath)
  const sidePanelContentHash = parseSearchToken(search.sidePanelContentHash)
  const result: ChatRouteSearch = {
    ...base,
    panel: EXTENSION_SIDE_PANEL_ROUTE_PANEL,
    sidePanelExtensionId,
    sidePanelId,
    ...(sidePanelPackagePath ? { sidePanelPackagePath } : {}),
    ...(sidePanelContentHash ? { sidePanelContentHash } : {}),
  }
  return result
}

/** The router hands over every search key it parsed; only ChatRouteSearch's keys are read. */
export function parseChatRouteSearch(rawSearch: object) {
  const search: RawChatSearch = rawSearch
  const panel = parseRightPanel(search.panel)
  const base = parseBaseChatSearch(search)

  if (panel === EXTENSION_SIDE_PANEL_ROUTE_PANEL) {
    return parseExtensionPanelSearch(search, base)
  }

  if (panel === 'file') {
    const filePath = parseSearchToken(search.filePath)
    const fileLine = parseFileLine(search.fileLine)
    // Files without a path is the navigator on its own (ADR 0043).
    const result: ChatRouteSearch = filePath
      ? { ...base, panel, filePath, ...(fileLine ? { fileLine } : {}) }
      : { ...base, panel }
    return result
  }

  if (panel === 'resources') {
    const resourceView = parseResourceView(search.resourceView)
    const resourceId = parseSearchToken(search.resourceId)
    const result: ChatRouteSearch = {
      ...base,
      panel,
      ...(resourceView ? { resourceView } : {}),
      ...(resourceId ? { resourceId } : {}),
    }
    return result
  }

  if (panel === 'change-request') {
    const changeRequestUrl = parseSearchToken(search.changeRequestUrl)
    const changeRequestSessionId = parseSearchToken(search.changeRequestSessionId)
    const result: ChatRouteSearch =
      changeRequestUrl && changeRequestSessionId
        ? { ...base, panel, changeRequestUrl, changeRequestSessionId }
        : base
    return result
  }

  const result: ChatRouteSearch = {
    ...base,
    ...(panel ? { panel } : {}),
  }
  return result
}

/** Prevent a request route retained during navigation from binding to another opened Session. */
export function changeRequestUrlFromSearch(
  search: ChatRouteSearch,
  openedSessionId: string | null,
) {
  if (
    search.panel !== 'change-request' ||
    !search.changeRequestUrl ||
    !search.changeRequestSessionId ||
    search.changeRequestSessionId !== openedSessionId
  ) {
    return null
  }
  const result: string | null = search.changeRequestUrl
  return result
}

export function resourceBrowserTargetFromSearch(search: ChatRouteSearch) {
  if (search.panel !== 'resources') return null
  const target: SessionResourceBrowserTarget | null = {
    view: search.resourceView ?? 'sources',
    ...(search.resourceId ? { resourceId: search.resourceId } : {}),
  }
  return target
}

export function extensionSidePanelTargetFromSearch(search: ChatRouteSearch) {
  if (
    search.panel !== EXTENSION_SIDE_PANEL_ROUTE_PANEL ||
    !search.sidePanelExtensionId ||
    !search.sidePanelId
  ) {
    return null
  }

  const target: ChatExtensionSidePanelTarget | null = {
    extensionId: search.sidePanelExtensionId,
    sidePanelId: search.sidePanelId,
    ...(search.sidePanelPackagePath ? { packagePath: search.sidePanelPackagePath } : {}),
    ...(search.sidePanelContentHash ? { contentHash: search.sidePanelContentHash } : {}),
  }
  return target
}

export function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab === value)
}
