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

const PR_JSON_FIELDS = 'title,url,baseRefName,headRefName,state,isDraft'

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

export const githubProvider: SourceControlProvider = {
  id: 'github',
  authStatus,
  openChangeRequest: async (projectPath: string, payload: OpenChangeRequestPayload) => {
    const args = [
      'pr',
      'create',
      '--head',
      payload.headRef,
      '--title',
      payload.title,
      '--body',
      payload.body ?? '',
    ]
    if (payload.baseRef) args.push('--base', payload.baseRef)
    if (payload.draft) args.push('--draft')
    const result = await runCli('gh', args, projectPath)
    if (result.code !== 0) return classifyFailure(result)
    // gh prints the created PR URL; fetch full metadata for the head ref.
    return viewPullRequest(projectPath, payload.headRef)
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
