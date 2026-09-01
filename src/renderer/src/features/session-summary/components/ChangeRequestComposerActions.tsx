import type { ChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { ExternalLink, GitPullRequest } from 'lucide-react'
import type { Ref } from 'react'
import { usesAppleShortcuts } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'

interface ChangeRequestComposerActionsProps {
  readonly model: {
    readonly terminology: ChangeRequestTerminology
    readonly running: boolean
    readonly branchMissing: boolean
    readonly onCreate: (draft: boolean) => void
    readonly pendingResourceRecord: boolean
    readonly onRetryResourceRecord: () => void
    readonly retryButtonRef: Ref<HTMLButtonElement>
    readonly browserUrl: string | null
    readonly onOpenBrowser: () => void
  }
}

export function ChangeRequestComposerActions({
  model: {
    terminology,
    running,
    branchMissing,
    onCreate,
    pendingResourceRecord,
    onRetryResourceRecord,
    retryButtonRef,
    browserUrl,
    onOpenBrowser,
  },
}: ChangeRequestComposerActionsProps) {
  return (
    <footer className="space-y-1 border-t border-border p-2">
      {pendingResourceRecord ? (
        <Button
          ref={retryButtonRef}
          variant="subtle"
          className="w-full justify-start"
          aria-disabled={running}
          onClick={() => {
            if (!running) onRetryResourceRecord()
          }}
        >
          <GitPullRequest className="size-4" />
          Retry adding {terminology.shortLabel} to Outputs
        </Button>
      ) : (
        <>
          <Button
            variant="ghost"
            className="w-full justify-start"
            disabled={branchMissing}
            aria-disabled={running || branchMissing}
            onClick={() => {
              if (!running) onCreate(true)
            }}
          >
            <GitPullRequest className="size-4" />
            Create draft {terminology.shortLabel}
          </Button>
          <Button
            variant="subtle"
            className="w-full justify-between"
            disabled={branchMissing}
            aria-disabled={running || branchMissing}
            onClick={() => {
              if (!running) onCreate(false)
            }}
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
        </>
      )}
      <Button
        variant="ghost"
        className="w-full justify-start"
        disabled={!browserUrl}
        aria-disabled={!browserUrl || running}
        onClick={() => {
          if (!running && browserUrl) onOpenBrowser()
        }}
      >
        <ExternalLink className="size-4" />
        Open {terminology.shortLabel} in browser
      </Button>
    </footer>
  )
}
