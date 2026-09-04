import type { SessionDetail } from '@shared/types/session'
import { CommitMessageDialog } from '@/features/git'
import { ChangeRequestComposer } from './ChangeRequestComposer'
import type { SessionSummaryHubController } from './use-session-summary-hub-controller'

export function SessionSummaryHubDialogs({
  session,
  controller,
}: {
  readonly session: SessionDetail
  readonly controller: SessionSummaryHubController
}) {
  const { dialogs } = controller.git
  return (
    <>
      {dialogs.composerOpen && dialogs.workingPath ? (
        <ChangeRequestComposer
          session={session}
          workingPath={dialogs.workingPath}
          gitStatus={dialogs.gitStatus}
          vcsStatus={dialogs.vcsStatus}
          onClose={dialogs.closeComposer}
          onCompleted={dialogs.completeChangeRequest}
        />
      ) : null}
      <CommitMessageDialog
        open={dialogs.commitOpen}
        fileCount={dialogs.commitFileCount}
        onCancel={dialogs.cancelCommit}
        onConfirm={dialogs.confirmCommit}
      />
    </>
  )
}
