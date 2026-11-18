import type { GuiStartupFailureReason } from '@shared/types/gui-startup'
import { AlertTriangle, FolderOpen, RefreshCw } from 'lucide-react'
import { formatDisplayPathsInText } from '@/shared/lib/display-path'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'

const TITLES: Readonly<Record<GuiStartupFailureReason, string>> = {
  error: "OpenWaggle couldn't start its Session Host",
  timeout: 'OpenWaggle is taking too long to start',
}

/**
 * What the window shows when the Session Host fails or is not ready in time (decision 3), in
 * place of the silent quit it replaces. Retry starts the Host again; Open logs shows the folder
 * holding the app and Host logs.
 */
export function HostStartupErrorView({
  reason,
  message,
  onRetry,
  onOpenLogs,
}: {
  readonly reason: GuiStartupFailureReason
  readonly message: string
  readonly onRetry: () => void
  readonly onOpenLogs: () => void
}) {
  return (
    <main role="alert" className="flex size-full items-center justify-center bg-bg px-6">
      <div className="drag-region fixed inset-x-0 top-0 h-12" />
      <section className="w-full max-w-md rounded-xl border border-error/30 bg-bg-secondary p-5">
        <div className="mb-3 flex items-center gap-2 text-error">
          <AlertTriangle aria-hidden="true" className="size-4" />
          <h1 className="text-sm font-semibold">{TITLES[reason]}</h1>
        </div>
        <p className="text-sm text-text-secondary">
          Your Sessions are safe. Retry, or open the logs to see what happened.
        </p>
        <PlainTextBlock
          reason="error"
          ariaLabel="Session Host startup error"
          className="mt-3 max-h-40 border border-border bg-bg text-text-tertiary"
        >
          {formatDisplayPathsInText(message, [])}
        </PlainTextBlock>
        <div className="mt-4 flex gap-2">
          <Button variant="accent" onClick={onRetry}>
            <RefreshCw aria-hidden="true" className="size-3" />
            Retry
          </Button>
          <Button variant="secondary" onClick={onOpenLogs}>
            <FolderOpen aria-hidden="true" className="size-3" />
            Open logs
          </Button>
        </div>
      </section>
    </main>
  )
}
