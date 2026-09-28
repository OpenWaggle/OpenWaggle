import type { ActionInvocation } from '@shared/types/action-definitions'
import { useId, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import {
  invocationDirectory,
  invocationText,
  preparationChanges,
} from '../../lib/action-panel-changes'
import { folderLabel, PREPARATION_COPY } from '../../lib/action-panel-copy'
import type { ActionPanelRequest } from '../../state/action-panel-store'
import { useActionPanelStore } from '../../state/action-panel-store'
import { ActionPanelChrome } from './ActionPanelChrome'

type ReviewRequest = Extract<ActionPanelRequest, { kind: 'review' }>

function RunsLine({ invocation }: { readonly invocation: ActionInvocation }) {
  return (
    <p className="text-sm leading-6 text-text-secondary">
      It runs{' '}
      <code className="break-all font-mono text-text-primary">{invocationText(invocation)}</code> in{' '}
      {folderLabel(invocationDirectory(invocation))}.
    </p>
  )
}

function reviewTitle(
  source: ReviewRequest['review']['entry']['source'],
  noun: string,
  changed: boolean,
) {
  if (source === 'local') return `Turn your worktree ${noun} on or off`
  return changed ? `A shared ${noun} changed` : `Check this shared ${noun}`
}

function waitingNote(automatic: boolean, phase: 'setup' | 'cleanup') {
  if (!automatic) return ''
  return phase === 'setup'
    ? ' The new worktree is waiting for your choice.'
    : ' Removing the worktree is waiting for your choice.'
}

function ProfileNote(props: { readonly request: ReviewRequest }) {
  const { entry, profileName, showProfile } = props.request.review
  const previous = entry.previous
  const moved =
    previous?.profileId !== undefined && previous.profileId !== entry.definition.profileId
  if (!showProfile && !moved) return null
  const from = previous?.profileName ?? previous?.profileId ?? ''
  return (
    <p className="text-sm leading-6 text-text-tertiary">
      {moved
        ? `It moved from the ${from} profile to the ${profileName} profile. This changes which worktrees run it.`
        : `Part of the ${profileName} profile.`}
    </p>
  )
}

/**
 * Reviewing a shared setup or cleanup before it runs on this computer (ADR 0038). Nothing is
 * turned on without an explicit choice; closing leaves it off.
 */
export function PreparationReviewPanel({ request }: { readonly request: ReviewRequest }) {
  const titleId = useId()
  const closePanel = useActionPanelStore((state) => state.closePanel)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { entry, automatic } = request.review
  const definition = entry.definition
  const noun = PREPARATION_COPY[definition.phase].noun
  const previous = entry.previous
  const changes = previous
    ? preparationChanges({ ...definition, invocation: previous.invocation }, definition)
    : []
  async function decide(enabled: boolean) {
    setBusy(true)
    setError(null)
    try {
      await request.review.decide(enabled)
      closePanel()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your choice.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <ActionPanelChrome
      titleId={titleId}
      title={reviewTitle(entry.source, noun, previous !== undefined)}
      projectPath={request.projectPath}
      otherSessionProject={null}
      onClose={closePanel}
      description={
        <>
          {entry.source === 'local'
            ? `This is your own ${noun}. Turning it off stops it running for new worktrees; closing leaves it as it is.`
            : 'Check it before it runs on your computer. Your choice stays on this computer, and closing leaves it off.'}
          {waitingNote(automatic, definition.phase)}
        </>
      }
      footer={
        <div className="grid gap-3">
          {error ? (
            <p role="alert" className="text-sm text-error-text">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 @max-md:grid @max-md:grid-cols-2">
            <Button
              variant="secondary"
              size="md"
              align="center"
              disabled={busy}
              onClick={() => void decide(false)}
            >
              Keep it off
            </Button>
            <Button
              variant="primary"
              size="md"
              align="center"
              disabled={busy}
              onClick={() => void decide(true)}
            >
              Turn on this version
            </Button>
          </div>
        </div>
      }
    >
      <ProfileNote request={request} />
      {changes.length > 0 ? (
        <section aria-label="What changed" className="grid gap-2">
          <h3 className="text-base font-semibold text-text-primary">What changed</h3>
          <ul className="grid gap-1.5 text-sm leading-6">
            {changes.map((change) => (
              <li key={change.label} className="break-words text-text-secondary">
                <span className="text-text-tertiary">{change.label}:</span>{' '}
                <code className="font-mono">{change.before}</code> →{' '}
                <code className="font-mono text-text-primary">{change.after}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-label="What it runs" className="grid gap-2">
        <h3 className="text-base font-semibold text-text-primary">What it runs</h3>
        <RunsLine invocation={definition.invocation} />
      </section>
    </ActionPanelChrome>
  )
}
