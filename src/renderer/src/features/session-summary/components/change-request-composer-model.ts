import type { GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import type { GitRunStackedActionOptions } from '@shared/types/vcs'

interface ChangeRequestActionInput {
  readonly session: SessionDetail
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly title: string
  readonly description: string
  readonly branchName: string
  readonly commitAndPush: boolean
  readonly createFeatureBranch: boolean
  readonly draft: boolean
}

function generatedDescription(session: SessionDetail, status: GitStatusSummary | null) {
  const lines = ['## Summary', '', `- ${session.title}`]
  if (status && status.filesChanged > 0) {
    lines.push('', '## Changes', '', `- ${String(status.filesChanged)} changed files`)
    lines.push(`- +${String(status.additions)} / -${String(status.deletions)}`)
  }
  return lines.join('\n')
}

export function wouldCreateEmptyFeatureBranch(
  input: Pick<
    ChangeRequestActionInput,
    'commitAndPush' | 'createFeatureBranch' | 'gitStatus' | 'vcsStatus'
  >,
) {
  if (!input.createFeatureBranch || input.commitAndPush) return false
  const committedChanges = Math.max(input.gitStatus?.ahead ?? 0, input.vcsStatus?.aheadCount ?? 0)
  return committedChanges === 0
}

export function emptyFeatureBranchValidationMessage(
  input: Pick<
    ChangeRequestActionInput,
    'commitAndPush' | 'createFeatureBranch' | 'gitStatus' | 'vcsStatus'
  >,
  requestLabel: string,
) {
  if (!wouldCreateEmptyFeatureBranch(input)) return null
  const action =
    input.gitStatus && input.gitStatus.filesChanged > 0
      ? 'Commit the local changes'
      : 'Create a commit'
  return `${action} before creating a ${requestLabel} from a new branch.`
}

export function changeRequestActionInput(
  input: ChangeRequestActionInput,
): GitRunStackedActionOptions {
  if (wouldCreateEmptyFeatureBranch(input)) {
    throw new Error('A new branch needs at least one committed change before creating a request.')
  }
  const title = input.title.trim() || input.session.title
  return {
    // `create_pr` is OpenWaggle's push-and-create workflow. It pushes even when the tree is
    // clean, so a local branch without an upstream is published before provider creation.
    action: input.commitAndPush ? 'commit_push_pr' : 'create_pr',
    sessionId: input.session.id,
    commitMessage: input.commitAndPush ? title : undefined,
    paths: input.commitAndPush
      ? (input.gitStatus?.changedFiles.map((file) => file.path) ?? [])
      : undefined,
    changeRequestTitle: title,
    changeRequestBody:
      input.description.trim() ||
      generatedDescription(input.session, input.commitAndPush ? input.gitStatus : null),
    draft: input.draft,
    createFeatureBranch: input.createFeatureBranch,
    featureBranchName: input.createFeatureBranch ? input.branchName : undefined,
    baseRef: input.vcsStatus?.defaultRef ?? undefined,
  }
}
