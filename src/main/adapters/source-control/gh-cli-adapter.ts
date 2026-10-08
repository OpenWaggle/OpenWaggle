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
import { runCli } from './cli-runner'
import { classifyFailure, cliMissingFailure, invalidRepositoryFailure } from './gh-cli-failures'
import { type GhRun, noAccountAccessFailure, viewForkParent } from './gh-cli-fork'
import {
  createGitHubPullRequest,
  findPullRequestByHead,
  GITHUB_PR_SUMMARY_FIELDS,
} from './gh-cli-pull-request-creation'
import { createGithubAccountRunner, type ProviderAccountPreference } from './github-account-runner'
import {
  githubRepositorySelector,
  repositoryBoundChangeRequestReference,
  resolveRepositoryChangeRequestIdentity,
} from './repository-context'

export interface SourceControlProviderOptions {
  /** Remembered Provider account for this repository; enables trying the host's other accounts. */
  readonly accountPreference?: ProviderAccountPreference
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
  run: GhRun,
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  ref: string,
): Promise<ChangeRequestResult> {
  const boundReference = repositoryBoundChangeRequestReference(repository, ref)
  if (!boundReference) return invalidRepositoryFailure()
  const result = await run(
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
  run: GhRun,
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  ref: string,
): Promise<ChangeRequestDetailsResult> {
  const boundReference = repositoryBoundChangeRequestReference(repository, ref)
  if (!boundReference) return invalidRepositoryFailure()
  const result = await run(
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
  runners: { readonly run: GhRun; readonly runWrite: GhRun },
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  reference: string,
  method: ChangeRequestMergeMethod,
  expectedHeadCommit: string,
): Promise<MergeChangeRequestResult> {
  const boundReference = repositoryBoundChangeRequestReference(repository, reference)
  if (!boundReference) return invalidRepositoryFailure()
  const result = await runners.runWrite(
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
  return viewPullRequestDetails(runners.run, repository, projectPath, boundReference)
}

async function listPullRequests(
  run: GhRun,
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
): Promise<ChangeRequestListResult> {
  const result = await run(
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
  options: SourceControlProviderOptions = {},
): SourceControlProvider {
  const accounts = options.accountPreference
    ? createGithubAccountRunner(repository.host, options.accountPreference)
    : null
  const run: GhRun = accounts ? accounts.run : (args, cwd) => runCli('gh', args, cwd)
  const runWrite: GhRun = accounts ? accounts.runWrite : run
  async function bound<T extends { readonly ok: boolean }>(
    operation: () => Promise<T>,
  ): Promise<T | SourceControlFailure> {
    const result = await operation()
    const unreachable = accounts?.unreachableBy() ?? null
    return !result.ok && unreachable && unreachable.length > 0
      ? noAccountAccessFailure(repository, unreachable)
      : result
  }
  return {
    id: 'github',
    authStatus: (projectPath) => authStatus(repository, projectPath),
    openChangeRequest: (projectPath: string, payload: OpenChangeRequestPayload) =>
      bound(() =>
        createGitHubPullRequest(projectPath, payload, repository, {
          classifyFailure,
          viewPullRequest: (path, ref) => viewPullRequest(run, repository, path, ref),
          run,
          runWrite,
        }),
      ),
    resolveChangeRequestForRef: (projectPath: string, headRef: string) =>
      bound(() => viewPullRequest(run, repository, projectPath, headRef)),
    listChangeRequests: (projectPath) =>
      bound(() => listPullRequests(run, repository, projectPath)),
    getChangeRequestDetails: (projectPath, reference) =>
      bound(() => viewPullRequestDetails(run, repository, projectPath, reference)),
    mergeChangeRequest: (projectPath, reference, method, expectedHeadCommit) =>
      bound(() =>
        mergePullRequest(
          { run, runWrite },
          repository,
          projectPath,
          reference,
          method,
          expectedHeadCommit,
        ),
      ),
    checkoutChangeRequest: (projectPath: string, reference: string) =>
      bound(async () => {
        const boundReference = repositoryBoundChangeRequestReference(repository, reference)
        if (!boundReference) return invalidRepositoryFailure()
        const result = await runWrite(
          ['pr', 'checkout', boundReference, '--repo', githubRepositorySelector(repository)],
          projectPath,
        )
        if (result.code !== 0) return classifyFailure(result)
        return { ok: true as const, reference: boundReference }
      }),
    account: () => accounts?.account() ?? null,
    forkParent: (projectPath) => viewForkParent(run, repository, projectPath),
    findChangeRequestForForkHead: (projectPath, head) =>
      bound(() =>
        findPullRequestByHead(
          projectPath,
          { headRef: head.ref, headOwner: head.owner, title: '' },
          repository,
          {
            classifyFailure,
            viewPullRequest: (path, ref) => viewPullRequest(run, repository, path, ref),
            run,
          },
        ),
      ),
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
