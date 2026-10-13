import path from 'node:path'
import { match } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import type { ToolCallResult } from '@shared/types/tools'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { captureMetadataResource } from './session-resource-capture-metadata'
import { occurrenceId, sha256 } from './session-resource-capture-shared'
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

export interface CapturedToolOutputGroup {
  readonly label: string
  readonly result: unknown
}

function capturedToolIdentity(name: string): CapturedToolIdentity {
  return { canonicalKey: `tool:${name}`, title: name }
}

export function toolResultResourceLabel(toolResult: ToolCallResult) {
  const name = toolResult.name.trim()
  if (!name || toolResult.isError) return null
  return capturedToolIdentity(name).title
}

export function toolResultOutputGroups(
  toolResult: ToolCallResult,
): readonly CapturedToolOutputGroup[] {
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
 * Occurrences that prove a tool result's useful metadata reached durable storage. A failed tool
 * records nothing, so it has no completion record for resumable backfill.
 */
export function toolResultCompletionOccurrenceIds(input: {
  readonly sessionId: SessionId
  readonly nodeId: string
  readonly toolResult: ToolCallResult
}) {
  return input.toolResult.isError ? [] : [toolResultOccurrenceId(input)]
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
    if (input.toolResult.isError) return
    const identity = capturedToolIdentity(toolName)
    yield* captureToolIdentityMetadata(input, identity, `read:tool:${String(input.toolResult.id)}`)
    yield* captureWebSearches(input, toolName)
    yield* captureExplicitSites(
      input,
      { label: identity.title, result: input.toolResult.result },
      String(input.toolResult.id),
    )
    yield* captureFileResource(input, toolName)
  })
}
