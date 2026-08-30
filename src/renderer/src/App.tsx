import { RouterProvider } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useActiveWorkingPath } from '@/features/git/hooks'
import { usePreferences, useSettingsSetup } from '@/features/settings/hooks'
import { router } from '@/router'

const SYNTAX_RESOURCE_IDLE_TIMEOUT_MS = 2_000

function AppLoadingView() {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="text-text-tertiary text-sm">Loading…</div>
    </div>
  )
}

function SyntaxResourceBootstrap() {
  const workingPath = useActiveWorkingPath()
  useEffect(() => {
    let active = true
    const loadResources = () => {
      void import('@/features/settings/state/syntax-theme-store').then((module) => {
        if (active) return module.useSyntaxThemeCatalogStore.getState().load(workingPath)
      })
    }
    if (typeof window.requestIdleCallback === 'function') {
      const request = window.requestIdleCallback(loadResources, {
        timeout: SYNTAX_RESOURCE_IDLE_TIMEOUT_MS,
      })
      return () => {
        active = false
        window.cancelIdleCallback(request)
      }
    }
    const timer = window.setTimeout(loadResources, 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [workingPath])
  return null
}

export function App() {
  useSettingsSetup()

  const { isLoaded } = usePreferences()

  if (!isLoaded) {
    return <AppLoadingView />
  }

  return (
    <>
      <SyntaxResourceBootstrap />
      <RouterProvider router={router} />
    </>
  )
}
