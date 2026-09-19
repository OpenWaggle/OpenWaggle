import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import type { ToolCallResult } from '@shared/types/tools'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { captureMetadataResource } from './session-resource-capture-metadata'
import { occurrenceId, sha256 } from './session-resource-capture-shared'
import {
  type CapturedToolOutputGroup,
  capturedOrchestrationTools,
} from './session-resource-capture-tool-output'
import { collectExplicitResources } from './session-resource-extraction'

const MAX_WEB_SEARCHES_PER_TOOL = 32
const MAX_WEB_SEARCH_QUERY_CHARACTERS = 4_096
const DIRECT_WEB_SEARCH_TOOL_NAMES = new Set([
  'web_search',
  'web-search',
  'web.search',
  'search_query',
])

export const SESSION_TOOL_CAPTURE_LIMIT = 128

function normalizedWebSearchQuery(value: unknown) {
  if (typeof value !== 'string') return null
  const query = value.trim()
  return query && query.length <= MAX_WEB_SEARCH_QUERY_CHARACTERS ? query : null
}

function explicitWebSearchQueries(toolName: string, args: Readonly<Record<string, unknown>>) {
  if (DIRECT_WEB_SEARCH_TOOL_NAMES.has(toolName)) {
    const query = normalizedWebSearchQuery(args.query) ?? normalizedWebSearchQuery(args.q)
    return query ? [query] : []
  }
  if ((toolName !== 'web' && toolName !== 'web__run') || !Array.isArray(args.search_query)) {
    return []
  }
  const queries: string[] = []
  for (const candidate of args.search_query) {
    if (queries.length >= MAX_WEB_SEARCHES_PER_TOOL) break
    if (!isRecord(candidate) || typeof candidate.q !== 'string') continue
    const query = normalizedWebSearchQuery(candidate.q)
    if (query) queries.push(query)
  }
  return queries
}

interface CapturedToolIdentity {
  readonly canonicalKey: string
  readonly title: string
}

interface ToolMetadataCaptureInput {
  readonly sessionId: SessionId
  readonly toolResult: ToolCallResult
  readonly nodeId: string
  readonly branchId: string | null
  readonly workingPath: string | null
  readonly createdAt: number
}

function gatewayToolIdentity(value: unknown): CapturedToolIdentity | null {
  if (!isRecord(value)) return null
  const gatewayDetails = value.kind === 'gateway' ? value : value.details
  if (!isRecord(gatewayDetails) || gatewayDetails.kind !== 'gateway') return null
  const gatewayResult = gatewayDetails.result
  if (!isRecord(gatewayResult) || !isRecord(gatewayResult.attribution)) return null
  const { serverInstanceId, serverLabel, toolName } = gatewayResult.attribution
  if (
    typeof serverInstanceId !== 'string' ||
    typeof serverLabel !== 'string' ||
    typeof toolName !== 'string'
  ) {
    return null
  }
  const normalizedServerId = serverInstanceId.trim()
  const normalizedServerLabel = serverLabel.trim()
  const normalizedToolName = toolName.trim()
  if (!normalizedServerId || !normalizedServerLabel || !normalizedToolName) return null
  return {
    canonicalKey: `tool:${normalizedServerId}:${normalizedToolName}`,
    title: `${normalizedToolName} · ${normalizedServerLabel}`,
  }
}

function capturedToolIdentity(input: {
  readonly name: string
  readonly result: unknown
  readonly details?: unknown
}) {
  return (
    gatewayToolIdentity(input.details) ??
    gatewayToolIdentity(input.result) ?? {
      canonicalKey: `tool:${input.name}`,
      title: input.name,
    }
  )
}

export function toolResultResourceLabel(toolResult: ToolCallResult) {
  const name = toolResult.name.trim()
  if (!name || toolResult.isError) return null
  return capturedToolIdentity({
    name,
    result: toolResult.result,
    details: toolResult.details,
  }).title
}

export function toolResultOutputGroups(
  toolResult: ToolCallResult,
): readonly CapturedToolOutputGroup[] {
  const children = capturedOrchestrationTools(toolResult)
  if (children.length > 0) return children
  const label = toolResultResourceLabel(toolResult)
  return label ? [{ label, result: toolResult.result }] : []
}

export function toolResultOccurrenceId(input: {
  readonly sessionId: SessionId
  readonly nodeId: string
  readonly toolResult: ToolCallResult
}) {
  return occurrenceId({
    sessionId: input.sessionId,
    nodeId: input.nodeId,
    suffix: `read:tool:${String(input.toolResult.id)}`,
  })
}

/**
 * Occurrences that prove a tool result's useful metadata reached durable storage.
 * Failed orchestrations intentionally omit the failed wrapper, so their completed
 * children are the durable completion record used by resumable backfill.
 */
export function toolResultCompletionOccurrenceIds(input: {
  readonly sessionId: SessionId
  readonly nodeId: string
  readonly toolResult: ToolCallResult
}) {
  if (!input.toolResult.isError) return [toolResultOccurrenceId(input)]
  return capturedOrchestrationTools(input.toolResult).map((child) =>
    occurrenceId({
      sessionId: input.sessionId,
      nodeId: input.nodeId,
      suffix: child.occurrenceKey,
    }),
  )
}

function fileToolActivity(toolName: string) {
  return match(toolName)
    .with('read', () => 'read' as const)
    .with('write', 'edit', () => 'updated' as const)
    .otherwise(() => null)
}

function captureToolIdentityMetadata(
  input: ToolMetadataCaptureInput,
  identity: CapturedToolIdentity,
  occurrenceKey: string,
) {
  return captureMetadataResource({
    sessionId: input.sessionId,
    nodeId: input.nodeId,
    branchId: input.branchId,
    occurrenceKey,
    canonicalKey: identity.canonicalKey,
    kind: 'tool',
    title: identity.title,
    mimeType: null,
    locator: null,
    available: true,
    actor: 'tool',
    activity: 'read',
    label: identity.title,
    createdAt: input.createdAt,
  })
}

function captureExplicitSites(
  input: ToolMetadataCaptureInput,
  group: CapturedToolOutputGroup,
  occurrenceKey: string,
) {
  return Effect.gen(function* () {
    const resources = collectExplicitResources(group.result)
    for (const [index, site] of resources.sites.entries()) {
      yield* captureMetadataResource({
        sessionId: input.sessionId,
        nodeId: input.nodeId,
        branchId: input.branchId,
        occurrenceKey: `${site.activity}:site:${occurrenceKey}:${String(index)}`,
        canonicalKey: `url:${site.url}`,
        kind: 'site',
        title: site.title,
        mimeType: 'text/html',
        locator: site.url,
        available: true,
        actor: 'tool',
        activity: site.activity,
        label: group.label,
        createdAt: input.createdAt,
      })
    }
  })
}

function captureWebSearches(input: ToolMetadataCaptureInput, toolName: string) {
  return Effect.gen(function* () {
    for (const [index, query] of explicitWebSearchQueries(
      toolName,
      input.toolResult.args,
    ).entries()) {
      yield* captureMetadataResource({
        sessionId: input.sessionId,
        nodeId: input.nodeId,
        branchId: input.branchId,
        occurrenceKey: `read:web-search:${String(input.toolResult.id)}:${String(index)}`,
        canonicalKey: `web-search:${sha256(Buffer.from(query))}`,
        kind: 'web-search',
        title: query,
        mimeType: null,
        locator: null,
        available: true,
        actor: 'tool',
        activity: 'read',
        label: toolName,
        createdAt: input.createdAt,
      })
    }
  })
}

function capturedFileTitle(normalizedPath: string, workingPath: string | null) {
  if (workingPath) {
    const relativePath = path.relative(path.resolve(workingPath), normalizedPath)
    const outsideWorkingPath =
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    if (relativePath && !outsideWorkingPath) return relativePath
  }
  return path.basename(normalizedPath)
}

function captureFileResource(input: ToolMetadataCaptureInput, toolName: string) {
  const filePath = input.toolResult.args.path
  const activity = fileToolActivity(toolName)
  if (!activity || typeof filePath !== 'string') return Effect.void
  const normalizedPath = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : input.workingPath
      ? path.resolve(input.workingPath, filePath)
      : null
  if (!normalizedPath) return Effect.void
  return captureMetadataResource({
    sessionId: input.sessionId,
    nodeId: input.nodeId,
    branchId: input.branchId,
    occurrenceKey: `${activity}:file:${String(input.toolResult.id)}`,
    canonicalKey: `file:${normalizedPath}`,
    kind: 'file',
    title: capturedFileTitle(normalizedPath, input.workingPath),
    mimeType: null,
    locator: normalizedPath,
    available: true,
    actor: 'tool',
    activity,
    label: toolName,
    createdAt: input.createdAt,
  })
}

export function captureToolResultMetadata(input: ToolMetadataCaptureInput) {
  return Effect.gen(function* () {
    const toolName = input.toolResult.name.trim()
    if (!toolName) return
    const children = capturedOrchestrationTools(input.toolResult)
    if (input.toolResult.isError && children.length === 0) return
    if (!input.toolResult.isError) {
      const identity = capturedToolIdentity({
        name: toolName,
        result: input.toolResult.result,
        details: input.toolResult.details,
      })
      yield* captureToolIdentityMetadata(
        input,
        identity,
        `read:tool:${String(input.toolResult.id)}`,
      )
      yield* captureWebSearches(input, toolName)
    }
    for (const child of children) {
      yield* captureToolIdentityMetadata(
        input,
        { canonicalKey: child.canonicalKey, title: child.label },
        child.occurrenceKey,
      )
      yield* captureExplicitSites(input, child, child.occurrenceKey.replace(/^read:tool:/u, ''))
    }
    if (children.length === 0 && !input.toolResult.isError) {
      const label = toolResultResourceLabel(input.toolResult)
      if (label) {
        yield* captureExplicitSites(
          input,
          { label, result: input.toolResult.result },
          String(input.toolResult.id),
        )
      }
    }
    if (input.toolResult.isError) return
    yield* captureFileResource(input, toolName)
  })
}
