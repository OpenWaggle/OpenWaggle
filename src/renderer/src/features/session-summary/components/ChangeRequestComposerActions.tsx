import type { ChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { CircleCheck, ExternalLink, GitPullRequest, Loader2, TriangleAlert } from 'lucide-react'
import type { Ref } from 'react'
import { usesAppleShortcuts } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import type { ChangeRequestPreflightView } from './use-change-request-preflight'

interface ChangeRequestActionModel {
  readonly terminology: ChangeRequestTerminology
  readonly running: boolean
  readonly branchMissing: boolean
  readonly onCreate: (draft: boolean) => void
  readonly pendingResourceRecord: boolean
  readonly requestCreated: boolean
  readonly onRetryResourceRecord: () => void
  readonly retryButtonRef: Ref<HTMLButtonElement>
  readonly browserUrl: string | null
  readonly preflight: ChangeRequestPreflightView
  readonly onOpenBrowser: () => void
}

interface ChangeRequestComposerActionsProps {
  readonly model: ChangeRequestActionModel
}

function PreflightStatus({ model }: { readonly model: ChangeRequestActionModel }) {
  const { preflight, running, terminology } = model
  if (model.requestCreated) return null
  return (
    <p
      role={running ? undefined : preflight.status === 'blocked' ? 'alert' : 'status'}
      aria-live={running ? undefined : 'polite'}
      className={`flex items-center gap-2 px-2.5 py-1.5 text-xs ${
        preflight.status === 'blocked' ? 'text-error-text' : 'text-text-tertiary'
      }`}
    >
      {running || preflight.status === 'checking' ? (
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
      ) : preflight.status === 'ready' ? (
        <CircleCheck aria-hidden="true" className="size-3.5 text-success" />
      ) : (
        <TriangleAlert aria-hidden="true" className="size-3.5" />
      )}
      {running ? `Creating ${terminology.shortLabel}…` : preflight.message}
    </p>
  )
}

function CreationActions({ model }: { readonly model: ChangeRequestActionModel }) {
  const disabled = model.branchMissing || model.preflight.nativeCreationBlocked
  const ariaDisabled = model.running || disabled
  const disabledTitle = model.preflight.nativeCreationBlocked ? model.preflight.message : undefined
  return (
    <>
      <Button
        variant="ghost"
        className="w-full justify-start"
        disabled={disabled}
        aria-disabled={ariaDisabled}
        title={disabledTitle}
        onClick={() => {
          if (!model.running) model.onCreate(true)
        }}
      >
        <GitPullRequest className="size-4" />
        Create draft {model.terminology.shortLabel}
      </Button>
      <Button
        variant="subtle"
        className="w-full justify-between"
        disabled={disabled}
        aria-disabled={ariaDisabled}
        title={disabledTitle}
        onClick={() => {
          if (!model.running) model.onCreate(false)
        }}
        aria-keyshortcuts="Control+Enter Meta+Enter"
      >
        <span className="flex items-center gap-1.5">
          <GitPullRequest className="size-4" />
          Create {model.terminology.shortLabel}
        </span>
        <span
          aria-hidden="true"
          className="rounded bg-bg px-1.5 py-0.5 font-sans text-xs text-text-tertiary"
        >
          {usesAppleShortcuts() ? '⌘↵' : 'Ctrl + Enter'}
        </span>
      </Button>
    </>
  )
}

function PrimaryActions({ model }: { readonly model: ChangeRequestActionModel }) {
  if (model.pendingResourceRecord) {
    return (
      <Button
        ref={model.retryButtonRef}
        variant="subtle"
        className="w-full justify-start"
        aria-disabled={model.running}
        onClick={() => {
          if (!model.running) model.onRetryResourceRecord()
        }}
      >
        <GitPullRequest className="size-4" />
        Retry adding {model.terminology.shortLabel} to Outputs
      </Button>
    )
  }
  return model.requestCreated ? null : <CreationActions model={model} />
}

export function ChangeRequestComposerActions({ model }: ChangeRequestComposerActionsProps) {
  return (
    <footer className="space-y-1 border-t border-border p-2">
      <PreflightStatus model={model} />
      <PrimaryActions model={model} />
      <Button
        variant="ghost"
        className="w-full justify-start"
        disabled={!model.browserUrl || model.running}
        onClick={() => {
          if (!model.running && model.browserUrl) model.onOpenBrowser()
        }}
      >
        <ExternalLink className="size-4" />
        Open {model.terminology.shortLabel} in browser
      </Button>
    </footer>
  )
}
