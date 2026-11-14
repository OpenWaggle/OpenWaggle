import type { ChangeRequestPreflightPayload, GitStatusSummary, VcsStatus } from '@shared/types/git'
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

export function changeRequestPreflightPayload(input: ChangeRequestActionInput) {
  return {
    headRef: input.createFeatureBranch
      ? input.branchName.trim()
      : (input.vcsStatus?.refName ?? input.gitStatus?.branch ?? ''),
    ...defaultBaseRef(input),
    title: input.title.trim() || input.session.title,
    body:
      input.description.trim() ||
      generatedDescription(input.session, input.commitAndPush ? input.gitStatus : null),
    draft: input.draft,
    createFeatureBranch: input.createFeatureBranch,
  } satisfies ChangeRequestPreflightPayload
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

export function changeRequestStatusReadinessMessage(
  input: Pick<ChangeRequestActionInput, 'gitStatus' | 'vcsStatus'>,
  requestLabel: string,
) {
  if (input.vcsStatus?.refName === null) {
    return `Create or check out a branch before creating a ${requestLabel}.`
  }
  if (
    input.vcsStatus?.defaultRef != null &&
    input.vcsStatus.refName === input.vcsStatus.defaultRef &&
    input.vcsStatus.hasWorkingTreeChanges &&
    input.gitStatus === null
  ) {
    return `Waiting for local change details before creating a ${requestLabel}.`
  }
  return null
}

export function changeRequestActionInput(input: ChangeRequestActionInput) {
  if (wouldCreateEmptyFeatureBranch(input)) {
    throw new Error('A new branch needs at least one committed change before creating a request.')
  }
  const title = input.title.trim() || input.session.title
  const options: GitRunStackedActionOptions = {
    // `create_pr` is OpenWaggle's push-and-create workflow. It pushes even when the tree is
    // clean, so a local branch without an upstream is published before provider creation.
    action: input.commitAndPush ? 'commit_push_pr' : 'create_pr',
    sessionId: input.session.id,
    ...(input.commitAndPush
      ? {
          commitMessage: title,
          paths: input.gitStatus?.changedFiles.map((file) => file.path) ?? [],
        }
      : {}),
    changeRequestTitle: title,
    changeRequestBody:
      input.description.trim() ||
      generatedDescription(input.session, input.commitAndPush ? input.gitStatus : null),
    draft: input.draft,
    createFeatureBranch: input.createFeatureBranch,
    // Preflight already chose and validated this exact ref. Re-running automatic suffixing after
    // the safety gate would make the mutation target differ from the branch that was approved.
    ...(input.createFeatureBranch
      ? { featureBranchName: input.branchName, exactFeatureBranchName: true }
      : {}),
    ...defaultBaseRef(input),
  }
  return options
}

/** The repository's default ref as the base, when the provider status reported one. */
function defaultBaseRef(input: Pick<ChangeRequestActionInput, 'vcsStatus'>) {
  const baseRef = input.vcsStatus?.defaultRef
  return baseRef === undefined || baseRef === null ? {} : { baseRef }
}
