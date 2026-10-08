import type { VcsStatus } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { openChangeRequestAtDestination } from '@/features/session-summary'
import { useUIStore } from '@/shell/ui-store'

/**
 * Opens the branch's change request at the user's Change request open destination: the
 * inspector by default, the provider website when the user or project prefers it.
 */
export function openSessionChangeRequest(
  vcsStatus: VcsStatus | null,
  session: SessionDetail | null,
  openInInspector: ((url: string) => void) | undefined,
) {
  const url = vcsStatus?.changeRequest?.url
  if (!url) return
  void openChangeRequestAtDestination({
    url,
    projectPath: session?.projectPath ?? null,
    ownerKey: session ? String(session.id) : '',
    openInInspector: openInInspector ?? null,
  }).catch((cause: unknown) => {
    useUIStore
      .getState()
      .showToast(cause instanceof Error ? cause.message : 'Could not open this request.', 'error')
  })
}
