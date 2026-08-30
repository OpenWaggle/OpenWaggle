import { useRouterState } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { SETTINGS_TABS, type SettingsTab } from '@/shell/ui-store'

const SETTINGS_PATH_PREFIX = '/settings/'
const LazyAppSettingsView = lazy(() =>
  import('@/features/settings/components').then((module) => ({
    default: module.AppSettingsView,
  })),
)

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

  return (
    <Suspense
      fallback={
        <output
          aria-live="polite"
          className="flex size-full items-center justify-center bg-bg text-sm text-text-tertiary"
        >
          Loading settings…
        </output>
      }
    >
      <LazyAppSettingsView activeTab={effectiveTab} />
    </Suspense>
  )
}
