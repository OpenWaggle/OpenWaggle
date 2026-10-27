import { RouterProvider } from '@tanstack/react-router'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import {
  HostStartupErrorView,
  openStartupLogs,
  retryGuiStartup,
  StartupSkeleton,
  useGuiStartupStatus,
} from '@/features/app-startup'
import { usePreferences, useSettingsSetup } from '@/features/settings/hooks'
import { router } from '@/router'
import { formatDisplayPathsInText } from '@/shared/lib/display-path'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'

const FINISHING_UPDATE_NOTICE = 'Finishing an update…'

/**
 * Before Settings load the window shows the startup skeleton (decision 3): Settings come from
 * the Session Host, which may still be starting. A failed or late Host start shows its error
 * screen, and a Host handing over to an update says so.
 */
function AppStartupView() {
  const startup = useGuiStartupStatus()
  if (startup.state === 'failed') {
    return (
      <HostStartupErrorView
        reason={startup.reason}
        message={startup.message}
        onRetry={retryGuiStartup}
        onOpenLogs={openStartupLogs}
      />
    )
  }
  return (
    <StartupSkeleton
      {...(startup.state === 'updating' ? { notice: FINISHING_UPDATE_NOTICE } : {})}
    />
  )
}

function AppSettingsErrorView({
  message,
  onRetry,
}: {
  readonly message: string
  readonly onRetry: () => void
}) {
  return (
    <main role="alert" className="flex size-full items-center justify-center bg-bg px-6">
      <section className="w-full max-w-md rounded-xl border border-error/30 bg-bg-secondary p-5">
        <div className="mb-3 flex items-center gap-2 text-error">
          <AlertTriangle aria-hidden="true" className="size-4" />
          <h1 className="text-sm font-semibold">Couldn't read your settings</h1>
        </div>
        <p className="text-sm text-text-secondary">
          OpenWaggle stopped before opening your workspace. It did not substitute default terminal,
          browser, or shortcut settings.
        </p>
        <PlainTextBlock
          reason="error"
          ariaLabel="Settings load error"
          className="mt-3 max-h-40 border border-border bg-bg text-text-tertiary"
        >
          {formatDisplayPathsInText(message, [])}
        </PlainTextBlock>
        <Button
          variant="accent"
          aria-label="Retry loading settings"
          onClick={onRetry}
          className="mt-4"
        >
          <RefreshCw aria-hidden="true" className="size-3" />
          Retry
        </Button>
      </section>
    </main>
  )
}

export function App() {
  const retrySettings = useSettingsSetup()

  const { isLoaded, loadError } = usePreferences()

  // Hook point for W3's B1 (router.tsx `useInitialRouteLoadSettled`): keep the skeleton until
  // the launch route has loaded too, so the first route render does not suspend.
  if (!isLoaded) {
    return <AppStartupView />
  }

  if (loadError !== null) {
    return <AppSettingsErrorView message={loadError} onRetry={retrySettings} />
  }

  return <RouterProvider router={router} />
}
