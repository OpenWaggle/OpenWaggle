import type { SettingsTab } from '@/stores/ui-store'

export interface ChatRouteSearch {
  readonly branch?: string
  readonly node?: string
  readonly diff?: 1
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

export function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  return {
    branch: parseSearchString(search.branch),
    node: parseSearchString(search.node),
    ...(search.diff === 1 || search.diff === '1' ? { diff: 1 } : {}),
  }
}

export function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab === value)
}
