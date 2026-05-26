import { isMatching, P } from '@diegogbrisa/ts-match'
import type { SettingsTab } from '@/shell'

export type ChatRightPanel = 'diff' | 'session-tree'

export interface ChatRouteSearch {
  readonly branch?: string
  readonly node?: string
  readonly diff?: 1
  readonly panel?: ChatRightPanel
}

const SETTINGS_TABS: readonly SettingsTab[] = [
  'general',
  'waggle',
  'mcp',
  'archived',
  'connections',
]

function parseSearchString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function parseRightPanel(value: unknown) {
  return isMatching(P.union('diff', 'session-tree'), value) ? value : undefined
}

export function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch {
  const branch = parseSearchString(search.branch)
  const node = parseSearchString(search.node)
  const panel = parseRightPanel(search.panel)

  return {
    ...(branch ? { branch } : {}),
    ...(node ? { node } : {}),
    ...(search.diff === 1 || search.diff === '1' ? { diff: 1 } : {}),
    ...(panel ? { panel } : {}),
  }
}

export function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab === value)
}
