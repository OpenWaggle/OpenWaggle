import type {
  ChangeRequestDetailsResult,
  ChangeRequestListResult,
  ChangeRequestMergeMethod,
  ChangeRequestResult,
  MergeChangeRequestResult,
  OpenChangeRequestPayload,
  SourceControlAuthResult,
  SourceControlFailure,
  SourceControlRepositoryIdentity,
  VcsChangeRequest,
} from '@shared/types/git'
import type { SourceControlProvider } from '../../ports/source-control-provider'
import { parseGhAuthStatus } from './auth-parse'
import { mapGhPullRequest, mapGhPullRequestDetails } from './change-request-parse'
import { type CliResult, runCli } from './cli-runner'
import { createGitHubPullRequest, GITHUB_PR_SUMMARY_FIELDS } from './gh-cli-pull-request-creation'
import {
  githubRepositorySelector,
  repositoryBoundChangeRequestReference,
  resolveRepositoryChangeRequestIdentity,
} from './repository-context'

function cliMissingFailure(): SourceControlFailure {
  return { ok: false, code: 'cli-missing', message: 'GitHub CLI (gh) is not installed.' }
}

function notAuthenticatedFailure(detail: string): SourceControlFailure {
  return {
    ok: false,
    code: 'not-authenticated',
    message: detail || 'Not authenticated with GitHub. Run `gh auth login`.',
  }
}

function unknownFailure(detail: string): SourceControlFailure {
  return { ok: false, code: 'unknown', message: detail || 'GitHub CLI command failed.' }
}

function invalidRepositoryFailure(): SourceControlFailure {
  return {
    ok: false,
    code: 'invalid-target',
    message: 'GitHub CLI returned a pull request outside the approved repository.',
  }
}

function classifyFailure(result: CliResult): SourceControlFailure {
  if (result.missing) return cliMissingFailure()
  const lower = result.stderr.toLowerCase()
  if (lower.includes('no pull requests found') || lower.includes('not found')) {
    return { ok: false, code: 'no-change-request', message: 'No pull request found for ref.' }
  }
  if (/auth|logged in|authentication/i.test(result.stderr)) {
    return notAuthenticatedFailure(result.stderr.trim())
  }
  return unknownFailure(result.stderr.trim())
}

const PR_DETAILS_JSON_FIELDS = [
  'number',
  'title',
  'url',
  'baseRefName',
  'headRefName',
  'headRefOid',
  'state',
  'isDraft',
  'author',
  'changedFiles',
  'additions',
  'deletions',
  'files',
  'statusCheckRollup',
  'latestReviews',
  'comments',
  'reviewDecision',
  'mergeable',
  'mergeStateStatus',
].join(',')

function verifiedPullRequest<TChangeRequest extends VcsChangeRequest>(
  repository: SourceControlRepositoryIdentity,
  changeRequest: TChangeRequest,
): TChangeRequest | null {
  const identity = resolveRepositoryChangeRequestIdentity(repository, changeRequest.url)
  return identity ? { ...changeRequest, url: identity.url } : null
}

async function authStatus(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
): Promise<SourceControlAuthResult> {
  const result = await runCli(
    'gh',
    ['auth', 'status', '--active', '--hostname', repository.host],
    projectPath,
  )
  if (result.missing) return cliMissingFailure()
  const status = parseGhAuthStatus(result.stdout, result.stderr)
  if (status.authenticated && status.host?.toLowerCase() !== repository.host.toLowerCase()) {
    return invalidRepositoryFailure()
  }
  return { ok: true, status }
}

async function viewPullRequest(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  ref: string,
): Promise<ChangeRequestResult> {
  const boundReference = repositoryBoundChangeRequestReference(repository, ref)
  if (!boundReference) return invalidRepositoryFailure()
  const result = await runCli(
    'gh',
    [
      'pr',
      'view',
      boundReference,
      '--repo',
      githubRepositorySelector(repository),
      '--json',
      GITHUB_PR_SUMMARY_FIELDS,
    ],
    projectPath,
  )
  if (result.code !== 0) return classifyFailure(result)
  const changeRequest = mapGhPullRequest(safeJsonParse(result.stdout))
  if (!changeRequest) {
    return { ok: false, code: 'no-change-request', message: 'No pull request found for ref.' }
  }
  const verified = verifiedPullRequest(repository, changeRequest)
  return verified ? { ok: true, changeRequest: verified } : invalidRepositoryFailure()
}

async function viewPullRequestDetails(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  ref: string,
): Promise<ChangeRequestDetailsResult> {
  const boundReference = repositoryBoundChangeRequestReference(repository, ref)
  if (!boundReference) return invalidRepositoryFailure()
  const result = await runCli(
    'gh',
    [
      'pr',
      'view',
      boundReference,
      '--repo',
      githubRepositorySelector(repository),
      '--json',
      PR_DETAILS_JSON_FIELDS,
    ],
    projectPath,
  )
  if (result.code !== 0) return classifyFailure(result)
  const changeRequest = mapGhPullRequestDetails(safeJsonParse(result.stdout))
  if (!changeRequest) {
    return { ok: false, code: 'no-change-request', message: 'No pull request found for ref.' }
  }
  const verified = verifiedPullRequest(repository, changeRequest)
  return verified ? { ok: true, changeRequest: verified } : invalidRepositoryFailure()
}

async function mergePullRequest(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  reference: string,
  method: ChangeRequestMergeMethod,
  expectedHeadCommit: string,
): Promise<MergeChangeRequestResult> {
  const boundReference = repositoryBoundChangeRequestReference(repository, reference)
  if (!boundReference) return invalidRepositoryFailure()
  const result = await runCli(
    'gh',
    [
      'pr',
      'merge',
      boundReference,
      '--repo',
      githubRepositorySelector(repository),
      '--match-head-commit',
      expectedHeadCommit,
      `--${method}`,
    ],
    projectPath,
  )
  if (result.code !== 0) return classifyFailure(result)
  return viewPullRequestDetails(repository, projectPath, boundReference)
}

async function listPullRequests(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
): Promise<ChangeRequestListResult> {
  const result = await runCli(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      githubRepositorySelector(repository),
      '--state',
      'open',
      '--limit',
      '50',
      '--json',
      GITHUB_PR_SUMMARY_FIELDS,
    ],
    projectPath,
  )
  if (result.code !== 0) return classifyFailure(result)
  const parsed = safeJsonParse(result.stdout)
  const changeRequests: VcsChangeRequest[] = []
  if (Array.isArray(parsed)) {
    for (const raw of parsed) {
      const changeRequest = mapGhPullRequest(raw)
      if (!changeRequest) continue
      const verified = verifiedPullRequest(repository, changeRequest)
      if (!verified) return invalidRepositoryFailure()
      changeRequests.push(verified)
    }
  }
  return { ok: true, changeRequests }
}

export function createGithubProvider(
  repository: SourceControlRepositoryIdentity,
): SourceControlProvider {
  return {
    id: 'github',
    authStatus: (projectPath) => authStatus(repository, projectPath),
    openChangeRequest: (projectPath: string, payload: OpenChangeRequestPayload) =>
      createGitHubPullRequest(projectPath, payload, repository, {
        classifyFailure,
        viewPullRequest: (path, ref) => viewPullRequest(repository, path, ref),
      }),
    resolveChangeRequestForRef: (projectPath: string, headRef: string) =>
      viewPullRequest(repository, projectPath, headRef),
    listChangeRequests: (projectPath) => listPullRequests(repository, projectPath),
    getChangeRequestDetails: (projectPath, reference) =>
      viewPullRequestDetails(repository, projectPath, reference),
    mergeChangeRequest: (projectPath, reference, method, expectedHeadCommit) =>
      mergePullRequest(repository, projectPath, reference, method, expectedHeadCommit),
    checkoutChangeRequest: async (projectPath: string, reference: string) => {
      const boundReference = repositoryBoundChangeRequestReference(repository, reference)
      if (!boundReference) return invalidRepositoryFailure()
      const result = await runCli(
        'gh',
        ['pr', 'checkout', boundReference, '--repo', githubRepositorySelector(repository)],
        projectPath,
      )
      if (result.code !== 0) return classifyFailure(result)
      return { ok: true, reference: boundReference }
    },
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
