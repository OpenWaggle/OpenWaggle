import { useRouterState } from '@tanstack/react-router'
import { AppSettingsView } from '@/components/app/AppSettingsView'
import type { SettingsTab } from '@/stores/ui-store'

const SETTINGS_PATH_PREFIX = '/settings/'
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

interface SettingsRouteSurfaceProps {
  readonly tab: SettingsTab
}

function isSettingsTab(value: string): value is SettingsTab {
  return SETTINGS_TABS.some((candidate) => candidate === value)
}

function settingsTabFromPathname(pathname: string): SettingsTab | null {
  if (!pathname.startsWith(SETTINGS_PATH_PREFIX)) {
    return null
  }

  const candidate = pathname.slice(SETTINGS_PATH_PREFIX.length).split('/')[0]
  return candidate && isSettingsTab(candidate) ? candidate : null
}

export function SettingsRouteSurface({ tab }: SettingsRouteSurfaceProps) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const effectiveTab = settingsTabFromPathname(pathname) ?? tab

  return <AppSettingsView activeTab={effectiveTab} />
}
