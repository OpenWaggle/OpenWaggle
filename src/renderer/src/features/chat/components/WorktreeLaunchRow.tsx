import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import {
  Check,
  ChevronRight,
  Circle,
  Laptop,
  LoaderCircle,
  RotateCcw,
  Split,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { cancelFirstSend, retryFirstSend } from '../lib/worktree-launch-recovery'
import { useChatDisplayText, useChatDisplayTextFormatter } from './ChatDisplayPathContext'

interface WorktreeLaunchRowProps {
  readonly sessionId: string
  readonly launch: WorktreeLaunchSnapshot
}

function StepIcon({ state }: { readonly state: 'pending' | 'active' | 'complete' | 'failed' }) {
  if (state === 'complete') {
    return <Check aria-hidden="true" className="size-3.5 text-success" />
  }
  if (state === 'active') {
    return <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-progress" />
  }
  if (state === 'failed') return <X aria-hidden="true" className="size-3.5 text-status-error" />
  return <Circle aria-hidden="true" className="size-3.5 text-text-muted" />
}

function WorktreeStep({
  label,
  state,
}: {
  readonly label: string
  readonly state: 'pending' | 'active' | 'complete' | 'failed'
}) {
  return (
    <div
      data-state={state}
      className={`flex items-center gap-2 text-sm ${
        state === 'active'
          ? 'text-progress'
          : state === 'complete'
            ? 'text-text-secondary'
            : state === 'failed'
              ? 'text-error-text'
              : 'text-text-tertiary'
      }`}
    >
      <StepIcon state={state} />
      <span>{label}</span>
    </div>
  )
}

function stepState(
  launch: WorktreeLaunchSnapshot,
  step: 'preparing-workspace' | 'checking-out-files',
) {
  const order = ['preparing-workspace', 'checking-out-files', 'worktree-created', 'starting-task']
  const currentIndex = order.indexOf(launch.stage)
  const stepIndex = order.indexOf(step)
  if (launch.status === 'failed' && currentIndex === stepIndex) return 'failed' as const
  if (currentIndex > stepIndex || launch.status === 'complete') return 'complete' as const
  if (currentIndex === stepIndex) return 'active' as const
  return 'pending' as const
}

function ActionButton({
  children,
  disabled,
  onClick,
}: {
  readonly children: React.ReactNode
  readonly disabled: boolean
  readonly onClick: () => void
}) {
  return (
    <Button
      variant="unstyled"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </Button>
  )
}

function WorktreeProgressSteps({
  launch,
  worktreeCreated,
}: {
  readonly launch: WorktreeLaunchSnapshot
  readonly worktreeCreated: boolean
}) {
  if (worktreeCreated) {
    const startingTaskState = launch.status === 'failed' ? 'failed' : 'active'
    return (
      <>
        <WorktreeStep label="Worktree created" state="complete" />
        <WorktreeStep label="Starting task" state={startingTaskState} />
      </>
    )
  }

  return (
    <>
      <WorktreeStep label="Preparing workspace" state={stepState(launch, 'preparing-workspace')} />
      <WorktreeStep label="Checking out files" state={stepState(launch, 'checking-out-files')} />
    </>
  )
}

function worktreeProgressAnnouncement(
  launch: WorktreeLaunchSnapshot,
  worktreeCreated: boolean,
  displayErrorMessage: string,
) {
  if (launch.status === 'failed') {
    return `Worktree setup failed${displayErrorMessage ? `: ${displayErrorMessage}` : ''}`
  }
  if (worktreeCreated) return 'Starting task'
  if (launch.stage === 'checking-out-files') return 'Checking out files'
  return 'Preparing workspace'
}

export function WorktreeLaunchRow({ sessionId, launch }: WorktreeLaunchRowProps) {
  const [showDetails, setShowDetails] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const complete = launch.status === 'complete'
  const worktreeCreated = launch.stage === 'worktree-created' || launch.stage === 'starting-task'
  const formatDisplayText = useChatDisplayTextFormatter()
  const displayErrorMessage = useChatDisplayText(launch.errorMessage ?? '')
  const displayActionError = useChatDisplayText(actionError ?? '')
  const progressAnnouncement = worktreeProgressAnnouncement(
    launch,
    worktreeCreated,
    displayErrorMessage,
  )

  function runAction(action: () => Promise<void>) {
    setActionPending(true)
    setActionError(null)
    void action()
      .catch((error: unknown) => {
        setActionError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setActionPending(false))
  }

  if (complete) {
    return (
      <section aria-label="Worktree created" className="text-text-tertiary">
        <Button
          variant="unstyled"
          aria-expanded={showDetails}
          className="flex items-center gap-2 text-xs transition-colors hover:text-text-secondary"
          onClick={() => setShowDetails((current) => !current)}
          type="button"
        >
          <ChevronRight
            aria-hidden="true"
            className={`size-3 transition-transform ${showDetails ? 'rotate-90' : ''}`}
          />
          <Split aria-hidden="true" className="size-3.5" />
          <span>Worktree created</span>
        </Button>
        {showDetails && (
          <div className="ml-5 mt-2 space-y-1 border-l border-border pl-3 font-mono text-xs text-text-muted">
            {launch.details.map((detail) => (
              <div key={detail}>{formatDisplayText(detail)}</div>
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <section
      aria-label={launch.status === 'failed' ? 'Worktree setup failed' : 'Creating a worktree'}
      className="space-y-2 text-text-secondary"
    >
      <p aria-live="polite" className="sr-only" role="status">
        {progressAnnouncement}
      </p>
      <div className="flex items-center gap-2 px-0.5 text-xs text-text-tertiary">
        <Split aria-hidden="true" className="size-3.5" />
        <span>{launch.status === 'failed' ? 'Worktree setup failed' : 'Creating a worktree'}</span>
      </div>
      <div className="rounded-2xl border border-border-light bg-bg-secondary/50 px-4 py-3.5">
        <div className="space-y-3">
          <WorktreeProgressSteps launch={launch} worktreeCreated={worktreeCreated} />
        </div>
        {displayErrorMessage && (
          <p className="mt-3 text-xs text-status-error">{displayErrorMessage}</p>
        )}
        {displayActionError && (
          <p className="mt-3 text-xs text-status-error">{displayActionError}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="unstyled"
            aria-expanded={showDetails}
            className="inline-flex items-center gap-1.5 px-0.5 py-1 text-xs text-text-muted transition-colors hover:text-text-secondary"
            onClick={() => setShowDetails((current) => !current)}
            type="button"
          >
            <ChevronRight
              aria-hidden="true"
              className={`size-3 transition-transform ${showDetails ? 'rotate-90' : ''}`}
            />
            More details
          </Button>
          <div className="flex items-center gap-1">
            {launch.status === 'failed' && (
              <ActionButton
                disabled={actionPending}
                onClick={() => runAction(() => retryFirstSend(sessionId))}
              >
                <RotateCcw aria-hidden="true" className="size-3.5" /> Retry
              </ActionButton>
            )}
            <ActionButton
              disabled={actionPending}
              onClick={() => runAction(() => retryFirstSend(sessionId, true))}
            >
              <Laptop aria-hidden="true" className="size-3.5" /> Work locally
            </ActionButton>
            <ActionButton
              disabled={actionPending}
              onClick={() => runAction(() => cancelFirstSend(sessionId))}
            >
              <X aria-hidden="true" className="size-3.5" /> Cancel
            </ActionButton>
          </div>
        </div>
        {showDetails && (
          <div className="mt-2 space-y-1 border-t border-border pt-2 font-mono text-xs text-text-muted">
            {launch.details.map((detail) => (
              <div key={detail}>{formatDisplayText(detail)}</div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
