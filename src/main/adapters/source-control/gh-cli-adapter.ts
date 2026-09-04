import { safeDecodeUnknown } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import type {
  ChangeRequestListResult,
  ChangeRequestResult,
  OpenChangeRequestPayload,
  SourceControlAuthResult,
  SourceControlFailure,
  VcsChangeRequest,
} from '@shared/types/git'
import type { SourceControlProvider } from '../../ports/source-control-provider'
import { parseGhAuthStatus } from './auth-parse'
import { mapGhPullRequest } from './change-request-parse'
import { type CliResult, runCli } from './cli-runner'

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

const PR_JSON_FIELDS = 'title,url,baseRefName,headRefName,headRepositoryOwner,state,isDraft'

async function authStatus(projectPath: string): Promise<SourceControlAuthResult> {
  const result = await runCli('gh', ['auth', 'status'], projectPath)
  if (result.missing) return cliMissingFailure()
  const status = parseGhAuthStatus(result.stdout, result.stderr)
  return { ok: true, status }
}

async function viewPullRequest(projectPath: string, ref: string): Promise<ChangeRequestResult> {
  const result = await runCli('gh', ['pr', 'view', ref, '--json', PR_JSON_FIELDS], projectPath)
  if (result.code !== 0) return classifyFailure(result)
  const changeRequest = mapGhPullRequest(safeJsonParse(result.stdout))
  if (!changeRequest) {
    return { ok: false, code: 'no-change-request', message: 'No pull request found for ref.' }
  }
  return { ok: true, changeRequest }
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
  hostname: string,
): Promise<boolean> {
  const result = await runCli(
    'gh',
    ['api', '--hostname', hostname, `users/${encodeURIComponent(owner)}`],
    projectPath,
  )
  if (result.code !== 0) return false
  return jsonStringProperty(safeJsonParse(result.stdout), 'type') === 'Organization'
}

interface RepositoryContext {
  readonly nameWithOwner: string
  readonly defaultBranch: string | null
  readonly hostname: string
}

async function repositoryContext(projectPath: string): Promise<RepositoryContext | null> {
  const result = await runCli(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef,url'],
    projectPath,
  )
  if (result.code !== 0) return null
  const parsed = safeJsonParse(result.stdout)
  const nameWithOwner = jsonStringProperty(parsed, 'nameWithOwner')
  const repositoryUrl = jsonStringProperty(parsed, 'url')
  const decoded = safeDecodeUnknown(jsonObjectSchema, parsed)
  const defaultBranchRef = decoded.success ? decoded.data.defaultBranchRef : null
  const defaultBranch = jsonStringProperty(defaultBranchRef, 'name')
  if (!nameWithOwner || !repositoryUrl) return null
  try {
    return { nameWithOwner, defaultBranch, hostname: new URL(repositoryUrl).hostname }
  } catch {
    return null
  }
}

function repositoryName(repository: string) {
  return repository.split('/').filter(Boolean).at(-1) ?? repository
}

async function createOrganizationForkPullRequest(
  projectPath: string,
  payload: OpenChangeRequestPayload,
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
  const fallbackHeadRepository = `${payload.headOwner}/${repositoryName(context.nameWithOwner)}`
  const headRepository = payload.headRepository ?? fallbackHeadRepository
  const args = [
    'api',
    '--hostname',
    context.hostname,
    '--method',
    'POST',
    `repos/${context.nameWithOwner}/pulls`,
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
): Promise<ChangeRequestResult> {
  if (!payload.headOwner) return viewPullRequest(projectPath, payload.headRef)
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
      PR_JSON_FIELDS,
    ],
    projectPath,
  )
  if (result.code !== 0) return classifyFailure(result)
  const parsed = safeJsonParse(result.stdout)
  const candidates: readonly unknown[] = Array.isArray(parsed) ? parsed : []
  const exact =
    candidates.find((candidate) => {
      const changeRequest = mapGhPullRequest(candidate)
      return (
        pullRequestHeadOwner(candidate)?.toLowerCase() === payload.headOwner?.toLowerCase() &&
        changeRequest?.headRef === payload.headRef &&
        (payload.baseRef === undefined || changeRequest.baseRef === payload.baseRef)
      )
    }) ?? null
  const changeRequest = mapGhPullRequest(exact)
  return changeRequest
    ? { ok: true, changeRequest }
    : { ok: false, code: 'no-change-request', message: 'No pull request found for ref.' }
}

function createdPullRequestFromOutput(
  result: CliResult,
  payload: OpenChangeRequestPayload,
): ChangeRequestResult | null {
  const url =
    jsonStringProperty(safeJsonParse(result.stdout), 'html_url') ??
    result.stdout.match(/https?:\/\/\S+/u)?.[0]
  if (!url) return null
  return {
    ok: true,
    changeRequest: {
      title: payload.title,
      url,
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
) {
  const resolved = await findPullRequestByHead(projectPath, payload)
  if (
    resolved.ok &&
    (resolved.changeRequest.state === 'open' || resolved.changeRequest.state === 'draft') &&
    resolved.changeRequest.headRef === payload.headRef &&
    (payload.baseRef === undefined || resolved.changeRequest.baseRef === payload.baseRef)
  ) {
    return resolved
  }
  if (result.code !== 0) return classifyFailure(result)
  return (
    createdPullRequestFromOutput(result, payload) ?? {
      ok: false,
      code: 'unknown',
      message: 'The pull request command succeeded, but the created request could not be verified.',
    }
  )
}

export const githubProvider: SourceControlProvider = {
  id: 'github',
  authStatus,
  openChangeRequest: async (projectPath: string, payload: OpenChangeRequestPayload) => {
    const context = payload.headOwner === undefined ? null : await repositoryContext(projectPath)
    const organizationHead =
      payload.headOwner !== undefined &&
      context !== null &&
      (await isOrganizationOwner(projectPath, payload.headOwner, context.hostname))
    let result: CliResult
    if (organizationHead && context) {
      result = await createOrganizationForkPullRequest(projectPath, payload, context)
    } else {
      const args = [
        'pr',
        'create',
        '--head',
        qualifiedHead(payload),
        '--title',
        payload.title,
        '--body',
        payload.body ?? '',
      ]
      if (payload.baseRef) args.push('--base', payload.baseRef)
      if (payload.draft) args.push('--draft')
      result = await runCli('gh', args, projectPath)
    }
    // Creation can succeed remotely even when the CLI exits non-zero (for example, a
    // connection drops while printing the response). Resolve the exact head before
    // reporting failure so a retry cannot create a duplicate request.
    // gh prints the created PR URL. Preserve that successful outcome when the
    // metadata lookup is transiently unavailable.
    return resolveCreatedPullRequest(projectPath, payload, result)
  },
  resolveChangeRequestForRef: (projectPath: string, headRef: string) =>
    viewPullRequest(projectPath, headRef),
  listChangeRequests: async (projectPath: string): Promise<ChangeRequestListResult> => {
    const result = await runCli('gh', ['pr', 'list', '--json', PR_JSON_FIELDS], projectPath)
    if (result.code !== 0) return classifyFailure(result)
    const parsed = safeJsonParse(result.stdout)
    const changeRequests: VcsChangeRequest[] = []
    if (Array.isArray(parsed)) {
      for (const raw of parsed) {
        const changeRequest = mapGhPullRequest(raw)
        if (changeRequest) changeRequests.push(changeRequest)
      }
    }
    return { ok: true, changeRequests }
  },
  checkoutChangeRequest: async (projectPath: string, reference: string) => {
    const result = await runCli('gh', ['pr', 'checkout', reference], projectPath)
    if (result.code !== 0) return classifyFailure(result)
    return { ok: true, reference }
  },
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
