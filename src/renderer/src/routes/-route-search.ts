import type { SettingsTab } from '@/stores/ui-store'

export type ChatRightPanel = 'diff' | 'session-tree'

export interface ChatRouteSearch {
  readonly branch?: string
  readonly node?: string
  readonly diff?: 1
  readonly panel?: ChatRightPanel
}

const SETTINGS_TABS: readonly SettingsTab[] = [
  'general',
  'configuration',
  'waggle',
  'personalization',
  'git',
  'environments',
  'worktrees',
  'archived',
  'connections',
]

function parseSearchString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function parseRightPanel(value: unknown): ChatRightPanel | undefined {
  return value === 'diff' || value === 'session-tree' ? value : undefined
}

export function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  const panel = parseRightPanel(search.panel)
  return {
    branch: parseSearchString(search.branch),
    node: parseSearchString(search.node),
    ...(search.diff === 1 || search.diff === '1' ? { diff: 1 } : {}),
    ...(panel ? { panel } : {}),
  }
}

export function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab === value)
}
