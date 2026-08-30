import type { GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import type { GitRunStackedActionOptions } from '@shared/types/vcs'

function generatedDescription(session: SessionDetail, status: GitStatusSummary | null) {
  const lines = ['## Summary', '', `- ${session.title}`]
  if (status && status.filesChanged > 0) {
    lines.push('', '## Changes', '', `- ${String(status.filesChanged)} changed files`)
    lines.push(`- +${String(status.additions)} / -${String(status.deletions)}`)
  }
  return lines.join('\n')
}

export function changeRequestActionInput(input: {
  readonly session: SessionDetail
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly title: string
  readonly description: string
  readonly branchName: string
  readonly commitAndPush: boolean
  readonly createFeatureBranch: boolean
  readonly draft: boolean
}): GitRunStackedActionOptions {
  const title = input.title.trim() || input.session.title
  return {
    action: input.commitAndPush ? 'commit_push_pr' : 'create_pr',
    commitMessage: input.commitAndPush ? title : undefined,
    paths: input.commitAndPush
      ? (input.gitStatus?.changedFiles.map((file) => file.path) ?? [])
      : undefined,
    changeRequestTitle: title,
    changeRequestBody:
      input.description.trim() || generatedDescription(input.session, input.gitStatus),
    draft: input.draft,
    createFeatureBranch: input.createFeatureBranch,
    featureBranchName: input.createFeatureBranch ? input.branchName : undefined,
    baseRef: input.vcsStatus?.defaultRef ?? undefined,
  }
}
