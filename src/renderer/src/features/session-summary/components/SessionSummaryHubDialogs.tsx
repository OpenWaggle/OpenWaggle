import type { SessionDetail } from '@shared/types/session'
import { CommitOrPushDialog, CommitOrPushStatusDialog } from '@/features/git'
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
      {dialogs.commitCommandOpen && dialogs.workingPath ? (
        dialogs.gitStatus ? (
          <CommitOrPushDialog
            repository={{
              sessionTitle: session.title,
              workingPath: dialogs.workingPath,
              gitStatus: dialogs.gitStatus,
              vcsStatus: dialogs.vcsStatus,
              remoteState: dialogs.remoteVcsState,
              branches: dialogs.branches,
            }}
            operation={{
              running: dialogs.commitCommandRunning,
              progress: dialogs.commitCommandProgress,
              run: dialogs.runCommitCommand,
              stop: dialogs.cancelCommitCommand,
            }}
            onClose={dialogs.closeCommitCommand}
          />
        ) : (
          <CommitOrPushStatusDialog
            error={dialogs.gitStatusError}
            onClose={dialogs.closeCommitCommand}
            onRetry={dialogs.refreshGitStatus}
          />
        )
      ) : null}
    </>
  )
}
