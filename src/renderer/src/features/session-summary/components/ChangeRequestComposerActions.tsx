import type { ChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { CircleCheck, ExternalLink, GitPullRequest, Loader2, TriangleAlert } from 'lucide-react'
import { usesAppleShortcuts } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import type { ChangeRequestPreflightView } from './use-change-request-preflight'

interface ChangeRequestComposerActionsProps {
  readonly terminology: ChangeRequestTerminology
  readonly running: boolean
  readonly runningLabel: string
  readonly branchMissing: boolean
  readonly preflight: ChangeRequestPreflightView
  readonly onCreate: (draft: boolean) => void
  readonly browserUrl: string | null
  readonly onOpenBrowser: () => void
}

export function ChangeRequestComposerActions({
  terminology,
  running,
  runningLabel,
  branchMissing,
  preflight,
  onCreate,
  browserUrl,
  onOpenBrowser,
}: ChangeRequestComposerActionsProps) {
  const nativeCreationDisabled = running || branchMissing || preflight.nativeCreationBlocked
  return (
    <footer className="space-y-1 border-t border-border p-2">
      {running ? (
        <p
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-text-tertiary"
        >
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          {runningLabel}
        </p>
      ) : (
        <p
          role={preflight.status === 'blocked' ? 'alert' : 'status'}
          aria-live="polite"
          className={`flex items-center gap-2 px-2.5 py-1.5 text-xs ${
            preflight.status === 'blocked' ? 'text-error-text' : 'text-text-tertiary'
          }`}
        >
          {preflight.status === 'checking' ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : preflight.status === 'ready' ? (
            <CircleCheck aria-hidden="true" className="size-3.5 text-success" />
          ) : (
            <TriangleAlert aria-hidden="true" className="size-3.5" />
          )}
          {preflight.message}
        </p>
      )}
      <Button
        variant="ghost"
        className="w-full justify-start"
        disabled={nativeCreationDisabled}
        title={preflight.nativeCreationBlocked ? preflight.message : undefined}
        onClick={() => onCreate(true)}
      >
        <GitPullRequest className="size-4" />
        Create draft {terminology.shortLabel}
      </Button>
      <Button
        variant="subtle"
        className="w-full justify-between"
        disabled={nativeCreationDisabled}
        title={preflight.nativeCreationBlocked ? preflight.message : undefined}
        onClick={() => onCreate(false)}
        aria-keyshortcuts="Control+Enter Meta+Enter"
      >
        <span className="flex items-center gap-1.5">
          <GitPullRequest className="size-4" />
          Create {terminology.shortLabel}
        </span>
        <span
          aria-hidden="true"
          className="rounded bg-bg px-1.5 py-0.5 font-sans text-xs text-text-tertiary"
        >
          {usesAppleShortcuts() ? '⌘↵' : 'Ctrl + Enter'}
        </span>
      </Button>
      <Button
        variant="ghost"
        className="w-full justify-start"
        disabled={!browserUrl || running}
        onClick={onOpenBrowser}
      >
        <ExternalLink className="size-4" />
        Open {terminology.shortLabel} in browser
      </Button>
    </footer>
  )
}
