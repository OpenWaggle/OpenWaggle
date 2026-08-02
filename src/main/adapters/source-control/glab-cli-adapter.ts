import type {
  ChangeRequestListResult,
  ChangeRequestResult,
  OpenChangeRequestPayload,
  SourceControlAuthResult,
  SourceControlFailure,
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
      '--target-branch',
      payload.baseRef,
      '--title',
      payload.title,
      '--description',
      payload.body ?? '',
    ]
    if (payload.draft) args.push('--draft')
    const result = await runCli('glab', args, projectPath)
    if (result.code !== 0) return classifyFailure(result)
    return viewMergeRequest(projectPath, payload.headRef)
  },
  resolveChangeRequestForRef: (projectPath: string, headRef: string) =>
    viewMergeRequest(projectPath, headRef),
  listChangeRequests: async (projectPath: string): Promise<ChangeRequestListResult> => {
    const result = await runCli('glab', ['mr', 'list', '-F', 'json'], projectPath)
    if (result.code !== 0) return classifyFailure(result)
    const parsed = safeJsonParse(result.stdout)
    const changeRequests = Array.isArray(parsed)
      ? parsed.map(mapGlabMergeRequest).filter((cr): cr is NonNullable<typeof cr> => cr !== null)
      : []
    return { ok: true, changeRequests }
  },
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
