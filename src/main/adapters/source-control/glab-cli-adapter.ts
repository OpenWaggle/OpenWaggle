import type {
  ChangeRequestDetailsResult,
  ChangeRequestListResult,
  ChangeRequestMergeMethod,
  ChangeRequestResult,
  MergeChangeRequestResult,
  SourceControlAuthResult,
  SourceControlFailure,
  SourceControlRepositoryIdentity,
  VcsChangeRequest,
} from '@shared/types/git'
import type { SourceControlProvider } from '../../ports/source-control-provider'
import { parseGlabAuthStatus } from './auth-parse'
import { mapGlabMergeRequest, mapGlabMergeRequestDetails } from './change-request-parse'
import { type CliResult, runCli } from './cli-runner'
import { createGitlabMergeRequest } from './glab-cli-merge-request-creation'
import {
  gitlabRepositorySelector,
  repositoryBoundChangeRequestReference,
  resolveRepositoryChangeRequestIdentity,
} from './repository-context'

function cliMissingFailure(): SourceControlFailure {
  return { ok: false, code: 'cli-missing', message: 'GitLab CLI (glab) is not installed.' }
}

function invalidRepositoryFailure(): SourceControlFailure {
  return {
    ok: false,
    code: 'invalid-target',
    message: 'GitLab CLI returned a merge request outside the approved repository.',
  }
}

function classifyFailure(result: CliResult): SourceControlFailure {
  if (result.missing) return cliMissingFailure()
  const lower = result.stderr.toLowerCase()
  if (lower.includes('not found') || lower.includes('no merge request')) {
    return { ok: false, code: 'no-change-request', message: 'No merge request found for ref.' }
  }
  if (/auth|logged in|authentication/i.test(result.stderr)) {
    return {
      ok: false,
      code: 'not-authenticated',
      message: result.stderr.trim() || 'Not authenticated with GitLab. Run `glab auth login`.',
    }
  }
  return {
    ok: false,
    code: 'unknown',
    message: result.stderr.trim() || 'GitLab CLI command failed.',
  }
}

function verifiedMergeRequest<TChangeRequest extends VcsChangeRequest>(
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
    'glab',
    ['auth', 'status', '--hostname', repository.host],
    projectPath,
  )
  if (result.missing) return cliMissingFailure()
  const status = parseGlabAuthStatus(result.stdout, result.stderr)
  if (status.authenticated && status.host?.toLowerCase() !== repository.host.toLowerCase()) {
    return invalidRepositoryFailure()
  }
  return { ok: true, status }
}

async function viewMergeRequest(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  ref: string,
): Promise<ChangeRequestResult> {
  const boundReference = repositoryBoundChangeRequestReference(repository, ref)
  if (!boundReference) return invalidRepositoryFailure()
  const result = await runCli(
    'glab',
    ['mr', 'view', boundReference, '--repo', gitlabRepositorySelector(repository), '-F', 'json'],
    projectPath,
  )
  if (result.code !== 0) return classifyFailure(result)
  const changeRequest = mapGlabMergeRequest(safeJsonParse(result.stdout))
  if (!changeRequest) {
    return { ok: false, code: 'no-change-request', message: 'No merge request found for ref.' }
  }
  const verified = verifiedMergeRequest(repository, changeRequest)
  return verified ? { ok: true, changeRequest: verified } : invalidRepositoryFailure()
}

async function viewMergeRequestDetails(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  ref: string,
): Promise<ChangeRequestDetailsResult> {
  const boundReference = repositoryBoundChangeRequestReference(repository, ref)
  if (!boundReference) return invalidRepositoryFailure()
  const result = await runCli(
    'glab',
    [
      'mr',
      'view',
      boundReference,
      '--repo',
      gitlabRepositorySelector(repository),
      '-F',
      'json',
      '--comments',
      '--per-page',
      '100',
    ],
    projectPath,
  )
  if (result.code !== 0) return classifyFailure(result)
  const changeRequest = mapGlabMergeRequestDetails(safeJsonParse(result.stdout))
  if (!changeRequest) {
    return { ok: false, code: 'no-change-request', message: 'No merge request found for ref.' }
  }
  const verified = verifiedMergeRequest(repository, changeRequest)
  return verified ? { ok: true, changeRequest: verified } : invalidRepositoryFailure()
}

async function mergeMergeRequest(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  reference: string,
  method: ChangeRequestMergeMethod,
  expectedHeadCommit: string,
): Promise<MergeChangeRequestResult> {
  const boundReference = repositoryBoundChangeRequestReference(repository, reference)
  if (!boundReference) return invalidRepositoryFailure()
  const args = [
    'mr',
    'merge',
    boundReference,
    '--repo',
    gitlabRepositorySelector(repository),
    '--sha',
    expectedHeadCommit,
    '--yes',
  ]
  if (method === 'squash') args.push('--squash')
  if (method === 'rebase') args.push('--rebase')
  const result = await runCli('glab', args, projectPath)
  if (result.code !== 0) return classifyFailure(result)
  return viewMergeRequestDetails(repository, projectPath, boundReference)
}

async function listMergeRequests(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
): Promise<ChangeRequestListResult> {
  const result = await runCli(
    'glab',
    [
      'mr',
      'list',
      '--repo',
      gitlabRepositorySelector(repository),
      '--per-page',
      '50',
      '-F',
      'json',
    ],
    projectPath,
  )
  if (result.code !== 0) return classifyFailure(result)
  const parsed = safeJsonParse(result.stdout)
  const changeRequests: VcsChangeRequest[] = []
  if (Array.isArray(parsed)) {
    for (const raw of parsed) {
      const changeRequest = mapGlabMergeRequest(raw)
      if (!changeRequest) continue
      const verified = verifiedMergeRequest(repository, changeRequest)
      if (!verified) return invalidRepositoryFailure()
      changeRequests.push(verified)
    }
  }
  return { ok: true, changeRequests }
}

export function createGitlabProvider(
  repository: SourceControlRepositoryIdentity,
): SourceControlProvider {
  return {
    id: 'gitlab',
    authStatus: (projectPath) => authStatus(repository, projectPath),
    openChangeRequest: (projectPath, payload) =>
      createGitlabMergeRequest(repository, projectPath, payload, {
        classifyFailure,
        invalidRepositoryFailure,
        viewMergeRequest: (path, ref) => viewMergeRequest(repository, path, ref),
      }),
    resolveChangeRequestForRef: (projectPath: string, headRef: string) =>
      viewMergeRequest(repository, projectPath, headRef),
    listChangeRequests: (projectPath) => listMergeRequests(repository, projectPath),
    getChangeRequestDetails: (projectPath, reference) =>
      viewMergeRequestDetails(repository, projectPath, reference),
    mergeChangeRequest: (projectPath, reference, method, expectedHeadCommit) =>
      mergeMergeRequest(repository, projectPath, reference, method, expectedHeadCommit),
    checkoutChangeRequest: async (projectPath: string, reference: string) => {
      const boundReference = repositoryBoundChangeRequestReference(repository, reference)
      if (!boundReference) return invalidRepositoryFailure()
      const result = await runCli(
        'glab',
        ['mr', 'checkout', boundReference, '--repo', gitlabRepositorySelector(repository)],
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
