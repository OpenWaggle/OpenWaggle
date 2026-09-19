import { safeDecodeUnknown } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import type {
  ChangeRequestResult,
  OpenChangeRequestPayload,
  SourceControlFailure,
  SourceControlRepositoryIdentity,
} from '@shared/types/git'
import { mapGlabMergeRequest } from './change-request-parse'
import { type CliResult, runCli } from './cli-runner'
import {
  gitlabRepositorySelector,
  resolveRepositoryChangeRequestIdentity,
} from './repository-context'

interface MergeRequestCreationDependencies {
  readonly classifyFailure: (result: CliResult) => SourceControlFailure
  readonly invalidRepositoryFailure: () => SourceControlFailure
  readonly viewMergeRequest: (projectPath: string, ref: string) => Promise<ChangeRequestResult>
}

function numberProperty(raw: unknown, property: string): number | null {
  const decoded = safeDecodeUnknown(jsonObjectSchema, raw)
  if (!decoded.success) return null
  const value = decoded.data[property]
  return typeof value === 'number' ? value : null
}

async function findForkMergeRequest(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  payload: OpenChangeRequestPayload,
  dependencies: MergeRequestCreationDependencies,
): Promise<ChangeRequestResult> {
  if (!payload.headRepository) {
    return dependencies.viewMergeRequest(projectPath, payload.headRef)
  }
  const projectResult = await runCli(
    'glab',
    [
      'api',
      '--hostname',
      repository.host,
      `projects/${encodeURIComponent(payload.headRepository)}`,
    ],
    projectPath,
  )
  if (projectResult.code !== 0) return dependencies.classifyFailure(projectResult)
  const sourceProjectId = numberProperty(safeJsonParse(projectResult.stdout), 'id')
  if (sourceProjectId === null) {
    return { ok: false, code: 'no-change-request', message: 'No merge request found for ref.' }
  }
  const args = [
    'mr',
    'list',
    '--repo',
    gitlabRepositorySelector(repository),
    '--source-branch',
    payload.headRef,
    '--per-page',
    '100',
    '-F',
    'json',
  ]
  if (payload.baseRef) args.push('--target-branch', payload.baseRef)
  const listResult = await runCli('glab', args, projectPath)
  if (listResult.code !== 0) return dependencies.classifyFailure(listResult)
  const parsed = safeJsonParse(listResult.stdout)
  const candidates: readonly unknown[] = Array.isArray(parsed) ? parsed : []
  const exact = candidates.find((candidate) => {
    const changeRequest = mapGlabMergeRequest(candidate)
    return (
      numberProperty(candidate, 'source_project_id') === sourceProjectId &&
      changeRequest?.headRef === payload.headRef &&
      (payload.baseRef === undefined || changeRequest.baseRef === payload.baseRef)
    )
  })
  const changeRequest = mapGlabMergeRequest(exact)
  if (!changeRequest) {
    return { ok: false, code: 'no-change-request', message: 'No merge request found for ref.' }
  }
  const identity = resolveRepositoryChangeRequestIdentity(repository, changeRequest.url)
  return identity
    ? { ok: true, changeRequest: { ...changeRequest, url: identity.url } }
    : dependencies.invalidRepositoryFailure()
}

function createdMergeRequestFromOutput(
  repository: SourceControlRepositoryIdentity,
  result: CliResult,
  payload: OpenChangeRequestPayload,
): ChangeRequestResult | null {
  const url = result.stdout.match(/https?:\/\/\S+/u)?.[0]
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

async function resolveCreatedMergeRequest(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  payload: OpenChangeRequestPayload,
  result: CliResult,
  dependencies: MergeRequestCreationDependencies,
) {
  const resolved = await findForkMergeRequest(repository, projectPath, payload, dependencies)
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
    createdMergeRequestFromOutput(repository, result, payload) ?? {
      ok: false,
      code: 'unknown',
      message:
        'The merge request command succeeded, but the created request could not be verified.',
    }
  )
}

export async function createGitlabMergeRequest(
  repository: SourceControlRepositoryIdentity,
  projectPath: string,
  payload: OpenChangeRequestPayload,
  dependencies: MergeRequestCreationDependencies,
) {
  const args = [
    'mr',
    'create',
    '--repo',
    gitlabRepositorySelector(repository),
    '--source-branch',
    payload.headRef,
    '--title',
    payload.title,
    '--description',
    payload.body ?? '',
    '--yes',
  ]
  if (payload.baseRef) args.push('--target-branch', payload.baseRef)
  if (payload.headRepository) args.push('--head', payload.headRepository)
  if (payload.draft) args.push('--draft')
  const result = await runCli('glab', args, projectPath)
  return resolveCreatedMergeRequest(repository, projectPath, payload, result, dependencies)
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
