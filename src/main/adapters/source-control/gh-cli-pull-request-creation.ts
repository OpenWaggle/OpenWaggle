import { safeDecodeUnknown } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import type {
  ChangeRequestResult,
  OpenChangeRequestPayload,
  SourceControlFailure,
  SourceControlRepositoryIdentity,
} from '@shared/types/git'
import { mapGhPullRequest } from './change-request-parse'
import { type CliResult, runCli } from './cli-runner'
import {
  githubRepositorySelector,
  matchesRepositoryUrl,
  resolveRepositoryChangeRequestIdentity,
} from './repository-context'

export const GITHUB_PR_SUMMARY_FIELDS =
  'title,url,baseRefName,headRefName,headRepositoryOwner,state,isDraft'

interface PullRequestCreationDependencies {
  readonly classifyFailure: (result: CliResult) => SourceControlFailure
  readonly viewPullRequest: (projectPath: string, ref: string) => Promise<ChangeRequestResult>
}

function qualifiedHead(payload: OpenChangeRequestPayload) {
  return payload.headOwner ? `${payload.headOwner}:${payload.headRef}` : payload.headRef
}

function jsonStringProperty(raw: unknown, property: string): string | null {
  const decoded = safeDecodeUnknown(jsonObjectSchema, raw)
  if (!decoded.success) return null
  const value = decoded.data[property]
  return typeof value === 'string' ? value : null
}

async function isOrganizationOwner(
  projectPath: string,
  owner: string,
  repository: SourceControlRepositoryIdentity,
) {
  const result = await runCli(
    'gh',
    ['api', '--hostname', repository.host, `users/${encodeURIComponent(owner)}`],
    projectPath,
  )
  if (result.code !== 0) return false
  return jsonStringProperty(safeJsonParse(result.stdout), 'type') === 'Organization'
}

interface RepositoryContext {
  readonly defaultBranch: string | null
}

async function repositoryContext(
  projectPath: string,
  repository: SourceControlRepositoryIdentity,
): Promise<RepositoryContext | null> {
  const result = await runCli(
    'gh',
    [
      'repo',
      'view',
      githubRepositorySelector(repository),
      '--json',
      'nameWithOwner,defaultBranchRef,url',
    ],
    projectPath,
  )
  if (result.code !== 0) return null
  const parsed = safeJsonParse(result.stdout)
  const nameWithOwner = jsonStringProperty(parsed, 'nameWithOwner')
  const repositoryUrl = jsonStringProperty(parsed, 'url')
  const decoded = safeDecodeUnknown(jsonObjectSchema, parsed)
  const defaultBranchRef = decoded.success ? decoded.data.defaultBranchRef : null
  const defaultBranch = jsonStringProperty(defaultBranchRef, 'name')
  const expectedNameWithOwner = `${repository.owner}/${repository.repository}`
  if (
    nameWithOwner?.toLowerCase() !== expectedNameWithOwner.toLowerCase() ||
    !repositoryUrl ||
    !matchesRepositoryUrl(repository, repositoryUrl)
  ) {
    return null
  }
  return { defaultBranch }
}

function repositoryName(repository: string) {
  return repository.split('/').filter(Boolean).at(-1) ?? repository
}

async function createOrganizationForkPullRequest(
  projectPath: string,
  payload: OpenChangeRequestPayload,
  repository: SourceControlRepositoryIdentity,
  context: RepositoryContext,
): Promise<CliResult> {
  const baseRef = payload.baseRef ?? context.defaultBranch
  if (!baseRef) {
    return {
      stdout: '',
      stderr: 'Could not resolve the GitHub base branch.',
      code: 1,
      missing: false,
    }
  }
  const fallbackHeadRepository = `${payload.headOwner}/${repository.repository}`
  const headRepository = payload.headRepository ?? fallbackHeadRepository
  const args = [
    'api',
    '--hostname',
    repository.host,
    '--method',
    'POST',
    `repos/${repository.owner}/${repository.repository}/pulls`,
    '--raw-field',
    `title=${payload.title}`,
    '--raw-field',
    `head=${qualifiedHead(payload)}`,
    '--raw-field',
    `head_repo=${repositoryName(headRepository)}`,
    '--raw-field',
    `base=${baseRef}`,
    '--raw-field',
    `body=${payload.body ?? ''}`,
  ]
  if (payload.draft) args.push('--field', 'draft=true')
  return runCli('gh', args, projectPath)
}

function pullRequestHeadOwner(raw: unknown): string | null {
  const decoded = safeDecodeUnknown(jsonObjectSchema, raw)
  if (!decoded.success) return null
  const owner = safeDecodeUnknown(jsonObjectSchema, decoded.data.headRepositoryOwner)
  if (!owner.success) return null
  const login = owner.data.login
  return typeof login === 'string' ? login : null
}

async function findPullRequestByHead(
  projectPath: string,
  payload: OpenChangeRequestPayload,
  repository: SourceControlRepositoryIdentity,
  dependencies: PullRequestCreationDependencies,
): Promise<ChangeRequestResult> {
  if (!payload.headOwner) return dependencies.viewPullRequest(projectPath, payload.headRef)
  const result = await runCli(
    'gh',
    [
      'pr',
      'list',
      '--head',
      payload.headRef,
      '--state',
      'open',
      '--limit',
      '100',
      '--json',
      GITHUB_PR_SUMMARY_FIELDS,
      '--repo',
      githubRepositorySelector(repository),
    ],
    projectPath,
  )
  if (result.code !== 0) return dependencies.classifyFailure(result)
  const parsed = safeJsonParse(result.stdout)
  const candidates: readonly unknown[] = Array.isArray(parsed) ? parsed : []
  const exact = candidates.find((candidate) => {
    const changeRequest = mapGhPullRequest(candidate)
    return (
      pullRequestHeadOwner(candidate)?.toLowerCase() === payload.headOwner?.toLowerCase() &&
      changeRequest?.headRef === payload.headRef &&
      (payload.baseRef === undefined || changeRequest.baseRef === payload.baseRef)
    )
  })
  const changeRequest = mapGhPullRequest(exact)
  if (!changeRequest) {
    return { ok: false, code: 'no-change-request', message: 'No pull request found for ref.' }
  }
  const identity = resolveRepositoryChangeRequestIdentity(repository, changeRequest.url)
  return identity
    ? { ok: true, changeRequest: { ...changeRequest, url: identity.url } }
    : {
        ok: false,
        code: 'invalid-target',
        message: 'GitHub CLI returned a pull request outside the approved repository.',
      }
}

function createdPullRequestFromOutput(
  result: CliResult,
  payload: OpenChangeRequestPayload,
  repository: SourceControlRepositoryIdentity,
): ChangeRequestResult | null {
  const url =
    jsonStringProperty(safeJsonParse(result.stdout), 'html_url') ??
    result.stdout.match(/https?:\/\/\S+/u)?.[0]
  if (!url) return null
  const identity = resolveRepositoryChangeRequestIdentity(repository, url)
  if (!identity) return null
  return {
    ok: true,
    changeRequest: {
      title: payload.title,
      url: identity.url,
      baseRef: payload.baseRef ?? '',
      headRef: payload.headRef,
      state: payload.draft ? 'draft' : 'open',
    },
  }
}

async function resolveCreatedPullRequest(
  projectPath: string,
  payload: OpenChangeRequestPayload,
  result: CliResult,
  repository: SourceControlRepositoryIdentity,
  dependencies: PullRequestCreationDependencies,
) {
  const resolved = await findPullRequestByHead(projectPath, payload, repository, dependencies)
  if (
    resolved.ok &&
    (resolved.changeRequest.state === 'open' || resolved.changeRequest.state === 'draft') &&
    resolved.changeRequest.headRef === payload.headRef &&
    (payload.baseRef === undefined || resolved.changeRequest.baseRef === payload.baseRef)
  ) {
    return resolved
  }
  if (result.code !== 0) return dependencies.classifyFailure(result)
  return (
    createdPullRequestFromOutput(result, payload, repository) ?? {
      ok: false,
      code: 'unknown',
      message: 'The pull request command succeeded, but the created request could not be verified.',
    }
  )
}

export async function createGitHubPullRequest(
  projectPath: string,
  payload: OpenChangeRequestPayload,
  repository: SourceControlRepositoryIdentity,
  dependencies: PullRequestCreationDependencies,
) {
  const context =
    payload.headOwner === undefined ? null : await repositoryContext(projectPath, repository)
  const organizationHead =
    payload.headOwner !== undefined &&
    context !== null &&
    (await isOrganizationOwner(projectPath, payload.headOwner, repository))
  const result =
    organizationHead && context
      ? await createOrganizationForkPullRequest(projectPath, payload, repository, context)
      : await createStandardPullRequest(projectPath, payload, repository)
  // Resolve the exact head even after a non-zero exit so a retry cannot create a duplicate.
  return resolveCreatedPullRequest(projectPath, payload, result, repository, dependencies)
}

function createStandardPullRequest(
  projectPath: string,
  payload: OpenChangeRequestPayload,
  repository: SourceControlRepositoryIdentity,
) {
  const args = [
    'pr',
    'create',
    '--head',
    qualifiedHead(payload),
    '--title',
    payload.title,
    '--body',
    payload.body ?? '',
    '--repo',
    githubRepositorySelector(repository),
  ]
  if (payload.baseRef) args.push('--base', payload.baseRef)
  if (payload.draft) args.push('--draft')
  return runCli('gh', args, projectPath)
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
