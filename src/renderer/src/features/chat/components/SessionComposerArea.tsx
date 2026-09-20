import type { AgentSendPayload } from '@shared/types/agent'
import { useMessageQueueStore } from '@/features/chat/state'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useBranchSummaryStore } from '@/features/chat/state/branch-summary-store'
import { Composer } from '@/features/composer/components'
import { useComposerStore } from '@/features/composer/state'
import type { useComposerSendGate } from '../hooks/useComposerSendGate'
import { sessionImageSendFailureDisposition } from '../lib/session-image-send-failure'
import type { ChatComposerSectionState } from '../model'
import { ComposerSessionSetupDock } from './ComposerSessionSetupDock'
import { SessionAuthorizationModeMenu } from './SessionAuthorizationModeMenu'

interface SessionComposerAreaProps {
  readonly section: ChatComposerSectionState
  readonly strip: ReturnType<typeof useComposerSendGate>['strip']
  readonly composerDraftReady: boolean
  readonly guardedSend: (payload: AgentSendPayload) => Promise<void> | false
  readonly onEnqueue: (payload: AgentSendPayload) => undefined | false
}

export function SessionComposerArea({
  section,
  strip,
  composerDraftReady,
  guardedSend,
  onEnqueue,
}: SessionComposerAreaProps) {
  const branchSummaryMode = useBranchSummaryStore((s) => s.prompt?.mode ?? null)
  const composerAttachmentCount = useComposerStore((s) => s.attachments.length)
  const composerDisabledForBranchSummary =
    branchSummaryMode === 'choice' || branchSummaryMode === 'summarizing'
  const composerPlaceholder = !composerDraftReady
    ? 'Loading session draft…'
    : branchSummaryMode === 'custom'
      ? 'Custom instructions for the branch summary'
      : undefined

  return (
    <div>
      <ComposerSessionSetupDock section={section} strip={strip} />
      {branchSummaryMode === 'custom' && composerAttachmentCount > 0 ? (
        <p className="px-4 pb-1 text-xs text-text-tertiary" role="status">
          Attachments stay in your chat draft; the branch summary uses text only.
        </p>
      ) : null}
      <Composer
        sessionId={section.activeSessionId}
        accessControl={
          <SessionAuthorizationModeMenu
            projectPath={section.projectPath ?? null}
            session={section.session}
            onSetAuthorizationMode={section.onSetAuthorizationMode}
          />
        }
        onSend={guardedSend}
        onEnqueue={onEnqueue}
        onCancel={section.onCancel}
        isLoading={section.isLoading}
        mode={{
          disabled: !composerDraftReady || composerDisabledForBranchSummary,
          placeholder: composerPlaceholder,
          requiresText: branchSummaryMode === 'custom',
          clearOnSubmit: branchSummaryMode !== 'custom',
          recordHistory: branchSummaryMode !== 'custom',
          allowEnqueue: branchSummaryMode !== 'custom',
          sendTitle: branchSummaryMode === 'custom' ? 'Summarize branch' : undefined,
          onSendFailure: (cause) =>
            sessionImageSendFailureDisposition({
              cause,
              activeSessionId: section.activeSessionId,
              activeDraftContextKey: useComposerStore.getState().activeDraftContextKey,
              savedDraftContextKeys: Object.keys(useComposerStore.getState().scopedDrafts),
              disposedSessions: useMessageQueueStore.getState().disposedSessions,
              hasWorktreeLaunch: (sessionId) =>
                useBackgroundRunStore.getState().getWorktreeLaunch(sessionId) !== null,
            }),
        }}
        onToast={section.onToast}
      />
    </div>
  )
}
