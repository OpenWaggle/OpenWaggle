/// <reference types="vite/client" />

import { isMatching, P } from '@diegogbrisa/ts-match'
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL, SETTINGS_TABS, type SettingsTab } from '@/shell/ui-store'

export type ChatBuiltInRightPanel = 'diff' | 'file' | 'session-tree'
export type ChatRightPanel = ChatBuiltInRightPanel | typeof EXTENSION_SIDE_PANEL_ROUTE_PANEL
export type NotificationPrototypeVariant = 'B1' | 'B2' | 'B3' | 'N1' | 'N2' | 'N3'
export const NOTIFICATION_PROTOTYPE_ROUTES_ENABLED = import.meta.env.DEV

export interface ChatExtensionSidePanelTarget {
  readonly extensionId: string
  readonly sidePanelId: string
  readonly packagePath?: string
  readonly contentHash?: string
}

export interface ChatRouteSearch {
  readonly branch?: string
  readonly node?: string
  readonly diff?: 1
  readonly panel?: ChatRightPanel
  readonly prototype?: 'notifications'
  readonly variant?: NotificationPrototypeVariant
  readonly filePath?: string
  readonly fileLine?: number
  readonly sidePanelExtensionId?: string
  readonly sidePanelId?: string
  readonly sidePanelPackagePath?: string
  readonly sidePanelContentHash?: string
}

export interface ChatBuiltInRouteSearch extends ChatRouteSearch {
  readonly panel?: ChatBuiltInRightPanel
  readonly sidePanelExtensionId?: undefined
  readonly sidePanelId?: undefined
  readonly sidePanelPackagePath?: undefined
  readonly sidePanelContentHash?: undefined
}

export interface ChatExtensionSidePanelRouteSearch extends ChatRouteSearch {
  readonly panel: typeof EXTENSION_SIDE_PANEL_ROUTE_PANEL
  readonly sidePanelExtensionId: string
  readonly sidePanelId: string
  readonly sidePanelPackagePath?: string
  readonly sidePanelContentHash?: string
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
    P.union('diff', 'file', 'session-tree', EXTENSION_SIDE_PANEL_ROUTE_PANEL),
    value,
  )
    ? value
    : undefined
}

function parseNotificationPrototype(value: unknown) {
  return NOTIFICATION_PROTOTYPE_ROUTES_ENABLED && value === 'notifications' ? value : undefined
}

function parseNotificationPrototypeVariant(
  value: unknown,
): NotificationPrototypeVariant | undefined {
  if (!NOTIFICATION_PROTOTYPE_ROUTES_ENABLED) {
    return undefined
  }

  if (
    value === 'B1' ||
    value === 'B2' ||
    value === 'B3' ||
    value === 'N1' ||
    value === 'N2' ||
    value === 'N3'
  ) {
    return value
  }
  return undefined
}

function parseFileLine(value: unknown) {
  const numericValue = typeof value === 'string' ? Number(value) : value
  return typeof numericValue === 'number' && Number.isSafeInteger(numericValue) && numericValue > 0
    ? numericValue
    : undefined
}

function parseBaseChatSearch(search: Record<string, unknown>): ChatRouteSearch {
  const branch = parseSearchString(search.branch)
  const node = parseSearchString(search.node)
  const prototype = parseNotificationPrototype(search.prototype)
  const variant = parseNotificationPrototypeVariant(search.variant)
  return {
    ...(branch ? { branch } : {}),
    ...(node ? { node } : {}),
    ...(search.diff === 1 || search.diff === '1' ? { diff: 1 } : {}),
    ...(prototype ? { prototype } : {}),
    ...(variant ? { variant } : {}),
  }
}

function parseExtensionPanelSearch(
  search: Record<string, unknown>,
  base: ChatRouteSearch,
): ChatRouteSearch {
  const sidePanelExtensionId = parseSearchToken(search.sidePanelExtensionId)
  const sidePanelId = parseSearchToken(search.sidePanelId)
  if (!sidePanelExtensionId || !sidePanelId) return base

  const sidePanelPackagePath = parseSearchToken(search.sidePanelPackagePath)
  const sidePanelContentHash = parseSearchToken(search.sidePanelContentHash)
  return {
    ...base,
    panel: EXTENSION_SIDE_PANEL_ROUTE_PANEL,
    sidePanelExtensionId,
    sidePanelId,
    ...(sidePanelPackagePath ? { sidePanelPackagePath } : {}),
    ...(sidePanelContentHash ? { sidePanelContentHash } : {}),
  }
}

export function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  const panel = parseRightPanel(search.panel)
  const base = parseBaseChatSearch(search)

  if (panel === EXTENSION_SIDE_PANEL_ROUTE_PANEL) {
    return parseExtensionPanelSearch(search, base)
  }

  if (panel === 'file') {
    const filePath = parseSearchToken(search.filePath)
    const fileLine = parseFileLine(search.fileLine)
    return filePath ? { ...base, panel, filePath, ...(fileLine ? { fileLine } : {}) } : base
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
    ...(search.sidePanelPackagePath ? { packagePath: search.sidePanelPackagePath } : {}),
    ...(search.sidePanelContentHash ? { contentHash: search.sidePanelContentHash } : {}),
  }
}

export function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab === value)
}
