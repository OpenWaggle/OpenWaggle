import type {
  ChangeRequestListResult,
  ChangeRequestResult,
  OpenChangeRequestPayload,
  SourceControlAuthResult,
  SourceControlFailure,
  VcsChangeRequest,
} from '@shared/types/git'
import type { SourceControlProvider } from '../../ports/source-control-provider'
import { parseGlabAuthStatus } from './auth-parse'
import { mapGlabMergeRequest } from './change-request-parse'
import { type CliResult, runCli } from './cli-runner'

function cliMissingFailure(): SourceControlFailure {
  return { ok: false, code: 'cli-missing', message: 'GitLab CLI (glab) is not installed.' }
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

async function viewMergeRequest(projectPath: string, ref: string): Promise<ChangeRequestResult> {
  const result = await runCli('glab', ['mr', 'view', ref, '-F', 'json'], projectPath)
  if (result.code !== 0) return classifyFailure(result)
  const changeRequest = mapGlabMergeRequest(safeJsonParse(result.stdout))
  if (!changeRequest) {
    return { ok: false, code: 'no-change-request', message: 'No merge request found for ref.' }
  }
  return { ok: true, changeRequest }
}

function createdMergeRequestFromOutput(
  result: CliResult,
  payload: OpenChangeRequestPayload,
): ChangeRequestResult | null {
  const url = result.stdout.match(/https?:\/\/\S+/u)?.[0]
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

async function resolveCreatedMergeRequest(
  projectPath: string,
  payload: OpenChangeRequestPayload,
  result: CliResult,
) {
  const resolved = await viewMergeRequest(projectPath, payload.headRef)
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
    createdMergeRequestFromOutput(result, payload) ?? {
      ok: false,
      code: 'unknown',
      message:
        'The merge request command succeeded, but the created request could not be verified.',
    }
  )
}

export const gitlabProvider: SourceControlProvider = {
  id: 'gitlab',
  authStatus: async (projectPath: string): Promise<SourceControlAuthResult> => {
    const result = await runCli('glab', ['auth', 'status'], projectPath)
    if (result.missing) return cliMissingFailure()
    return { ok: true, status: parseGlabAuthStatus(result.stdout, result.stderr) }
  },
  openChangeRequest: async (projectPath: string, payload: OpenChangeRequestPayload) => {
    const args = [
      'mr',
      'create',
      '--source-branch',
      payload.headRef,
      '--title',
      payload.title,
      '--description',
      payload.body ?? '',
      '--yes',
    ]
    if (payload.baseRef) args.push('--target-branch', payload.baseRef)
    if (payload.draft) args.push('--draft')
    const result = await runCli('glab', args, projectPath)
    return resolveCreatedMergeRequest(projectPath, payload, result)
  },
  resolveChangeRequestForRef: (projectPath: string, headRef: string) =>
    viewMergeRequest(projectPath, headRef),
  listChangeRequests: async (projectPath: string): Promise<ChangeRequestListResult> => {
    const result = await runCli('glab', ['mr', 'list', '-F', 'json'], projectPath)
    if (result.code !== 0) return classifyFailure(result)
    const parsed = safeJsonParse(result.stdout)
    const changeRequests: VcsChangeRequest[] = []
    if (Array.isArray(parsed)) {
      for (const raw of parsed) {
        const changeRequest = mapGlabMergeRequest(raw)
        if (changeRequest) changeRequests.push(changeRequest)
      }
    }
    return { ok: true, changeRequests }
  },
  checkoutChangeRequest: async (projectPath: string, reference: string) => {
    const result = await runCli('glab', ['mr', 'checkout', reference], projectPath)
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
