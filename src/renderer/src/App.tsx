import { RouterProvider } from '@tanstack/react-router'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { usePreferences, useSettingsSetup } from '@/features/settings/hooks'
import { router } from '@/router'
import { formatDisplayPathsInText } from '@/shared/lib/display-path'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'

function AppLoadingView() {
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      <div className="text-text-tertiary text-sm">Loading…</div>
    </div>
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

  if (!isLoaded) {
    return <AppLoadingView />
  }

  if (loadError !== null) {
    return <AppSettingsErrorView message={loadError} onRetry={retrySettings} />
  }

  return <RouterProvider router={router} />
}
