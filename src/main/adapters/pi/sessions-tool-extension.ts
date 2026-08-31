import type { ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { SessionCapability } from '@shared/types/session-capability'
import { listAgentDefinitions, searchAgentDefinitions } from '../../agents/agent-definition-catalog'
import { executeSessionToolCommand } from '../../session-host/session-tool-gateway'
import { assertFilesystemWriteScope } from '../../utils/filesystem-write-scope'
import { getOpenWaggleAuthorize } from './agent-kernel/openwaggle-authorize-channel'
import { sessionsToolSchemaForCapabilities } from './sessions-tool-capability-schema'
import { type SessionsToolParameters, sessionsToolParameters } from './sessions-tool-parameters'
import { buildSessionsToolPayload } from './sessions-tool-payload'

const DEFAULT_AGENT_DEFINITION_RESULTS = 50

interface SessionsToolExtensionInput {
  readonly sessionId: string
  readonly runId: string
  readonly workingDirectory: string
  readonly projectPath?: string
  readonly sessionCapabilities?: readonly SessionCapability[]
  readonly modelMultiAgentEnabled?: boolean
}

type SessionsToolPayload = ReturnType<typeof buildSessionsToolPayload>

export { buildSessionsToolPayload } from './sessions-tool-payload'

export async function queryAgentDefinitionsForTool(
  input: Extract<
    SessionsToolParameters,
    { action: 'agent_definitions_list' | 'agent_definitions_search' }
  >,
  projectPath: string,
) {
  const definitions =
    input.action === 'agent_definitions_search'
      ? await searchAgentDefinitions({ projectPath, query: input.query })
      : await listAgentDefinitions({ projectPath })
  return {
    definitions: definitions
      .slice(0, input.limit ?? DEFAULT_AGENT_DEFINITION_RESULTS)
      .map((item) => ({
        name: item.name,
        description: item.description,
        scope: item.scope,
        valid: !item.loadError,
        ...(item.loadError ? { diagnostic: item.loadError } : {}),
      })),
  }
}

function isAgentDefinitionAction(
  params: SessionsToolParameters,
): params is Extract<
  SessionsToolParameters,
  { action: 'agent_definitions_list' | 'agent_definitions_search' }
> {
  return params.action === 'agent_definitions_list' || params.action === 'agent_definitions_search'
}

async function authorizeExportWrite(input: {
  readonly ctx: ExtensionContext
  readonly destinationPath: string
  readonly overwriteExisting: boolean
  readonly signal?: AbortSignal
}) {
  if (!input.ctx.hasUI) {
    throw new Error('Writing a Session export requires interactive filesystem authorization.')
  }
  const title = 'Allow Session export write?'
  const message = [
    `Destination: ${input.destinationPath}`,
    `Overwrite existing: ${input.overwriteExisting ? 'yes' : 'no'}`,
  ].join('\n')
  const authorize = getOpenWaggleAuthorize(input.ctx.ui)
  const approved = authorize
    ? await authorize({
        title,
        message,
        scopeKey: {
          requesterId: 'openwaggle:sessions',
          requester: 'OpenWaggle Sessions',
          capability: 'sessions.export-write',
          resource: 'workspace-export',
        },
        ...(input.signal ? { signal: input.signal } : {}),
      })
    : await input.ctx.ui.confirm(title, `${message}\n\nThis approval applies only to this call.`, {
        signal: input.signal,
      })
  if (!approved) throw new Error('Session export write was not authorized.')
}

async function authorizeAttachmentRead(input: {
  readonly ctx: ExtensionContext
  readonly paths: readonly string[]
  readonly signal?: AbortSignal
}) {
  if (!input.ctx.hasUI) {
    throw new Error('Reading Session attachments requires interactive filesystem authorization.')
  }
  const title = 'Allow Session attachment read?'
  const message = `Files:\n${input.paths.map((entry) => `- ${entry}`).join('\n')}`
  const authorize = getOpenWaggleAuthorize(input.ctx.ui)
  const approved = authorize
    ? await authorize({
        title,
        message,
        scopeKey: {
          requesterId: 'openwaggle:sessions',
          requester: 'OpenWaggle Sessions',
          capability: 'sessions.attachment-read',
          resource: 'workspace-attachments',
        },
        ...(input.signal ? { signal: input.signal } : {}),
      })
    : await input.ctx.ui.confirm(title, `${message}\n\nThis approval applies only to this call.`, {
        signal: input.signal,
      })
  if (!approved) throw new Error('Session attachment read was not authorized.')
}

async function authorizeExportResourceRead(input: {
  readonly ctx: ExtensionContext
  readonly paths: readonly string[]
  readonly signal?: AbortSignal
}) {
  if (!input.ctx.hasUI) {
    throw new Error('Bundling Session resources requires interactive filesystem authorization.')
  }
  const title = 'Allow Session export resource read?'
  const message = `Files:\n${input.paths.map((entry) => `- ${entry}`).join('\n')}`
  const authorize = getOpenWaggleAuthorize(input.ctx.ui)
  const approved = authorize
    ? await authorize({
        title,
        message,
        scopeKey: {
          requesterId: 'openwaggle:sessions',
          requester: 'OpenWaggle Sessions',
          capability: 'sessions.resource-read',
          resource: 'workspace-export-resources',
        },
        ...(input.signal ? { signal: input.signal } : {}),
      })
    : await input.ctx.ui.confirm(title, `${message}\n\nThis approval applies only to this call.`, {
        signal: input.signal,
      })
  if (!approved) throw new Error('Session export resource read was not authorized.')
}

async function authorizeAttachments(
  payload: SessionsToolPayload,
  ctx: ExtensionContext,
  signal?: AbortSignal,
) {
  const attachmentPaths =
    payload.contract === 'session-control-v2' || payload.contract === 'session-lifecycle-v2'
      ? payload.transport?.attachmentPaths
      : undefined
  if (!attachmentPaths?.length) return
  await authorizeAttachmentRead({ ctx, paths: attachmentPaths, ...(signal ? { signal } : {}) })
}

async function authorizeExport(
  payload: SessionsToolPayload,
  input: SessionsToolExtensionInput,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<SessionsToolPayload> {
  if (
    payload.contract !== 'session-control-v2' ||
    payload.request.command.operation !== 'export-create'
  ) {
    return payload
  }
  const resources = payload.request.command.resources?.map((resource) => resource.path)
  if (resources?.length) {
    await authorizeExportResourceRead({ ctx, paths: resources, ...(signal ? { signal } : {}) })
  }
  await authorizeExportWrite({
    ctx,
    destinationPath: payload.request.command.destinationPath,
    overwriteExisting: payload.request.command.overwriteExisting === true,
    ...(signal ? { signal } : {}),
  })
  const scope = await assertFilesystemWriteScope({
    roots: [input.workingDirectory],
    destinationPath: payload.request.command.destinationPath,
  })
  return {
    ...payload,
    request: {
      ...payload.request,
      command: {
        ...payload.request.command,
        destinationPath: scope.destinationPath,
        destinationRoot: scope.rootPath,
      },
    },
  }
}

async function executeSessionsTool(
  params: SessionsToolParameters,
  input: SessionsToolExtensionInput,
  ctx: ExtensionContext,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new Error('aborted')
  if (isAgentDefinitionAction(params)) {
    return queryAgentDefinitionsForTool(params, input.workingDirectory)
  }
  const initialPayload = buildSessionsToolPayload(params, input)
  await authorizeAttachments(initialPayload, ctx, signal)
  const payload = await authorizeExport(initialPayload, input, ctx, signal)
  return executeSessionToolCommand({
    sourceSessionId: input.sessionId,
    sourceRunId: input.runId,
    workingDirectory: input.workingDirectory,
    projectPath: input.projectPath,
    payload,
    ...(signal ? { signal } : {}),
  })
}

function successfulToolResult(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result }
}

function failedToolResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: 'text' as const, text: message }],
    details: undefined,
    isError: true,
  }
}

export function createSessionsToolExtension(input: SessionsToolExtensionInput): ExtensionFactory {
  return (pi) => {
    pi.registerTool<typeof sessionsToolParameters, unknown>({
      name: 'sessions',
      label: 'Sessions',
      description:
        'Coordinate durable OpenWaggle sessions. Spawn Worker Sessions in the current Hive, discover and read authorized sessions, report durable peer context, send future Follow-ups, steer an exact active Run, or interrupt it. The Hive root is the Queen Session; every descendant is a Worker Session. Workers are ordinary sidebar sessions with independent transcripts and may continue after this Run ends.',
      promptSnippet:
        'Use sessions to spawn and coordinate durable Worker Sessions when parallel or delegated work is useful.',
      promptGuidelines: [
        'Use spawn for a new Worker Session; it never creates an in-memory subagent.',
        'Use launch for an independent root Session that starts immediately, or create for an idle independent root. Neither joins the current Hive.',
        'Use start for an idle Session, follow_up for durable work after its current Run, steer to append to one exact active Run, replace to interrupt and restart, and promote to move one queued Follow-up into an exact active Run.',
        'launch, spawn, start, follow_up, and replace accept authorization: yolo only when the caller grant permits that effective access.',
        'Use requests_list to inspect parked interactions. request_respond cannot approve Authorization; approval_respond requires an explicit delegated approval grant.',
        'authorization_set changes a persistent Session boundary and requires its stronger dedicated grant.',
        'Use report for provenance-labelled peer context that must not start, steer, or reopen a Run.',
        'Workers submit immutable Delegation results; parents request revision or accept an exact submission revision.',
        'Search before reading broad history, and page transcript items deliberately.',
        'Use export_create for a durable file or bundle export, then exports_wait or exports_read to inspect completion. Export destinations stay inside the current workspace.',
        'Discover optional Agent definitions on demand; do not assume named roles exist.',
      ],
      parameters: input.sessionCapabilities
        ? sessionsToolSchemaForCapabilities({
            capabilities: input.sessionCapabilities,
            modelMultiAgentEnabled: input.modelMultiAgentEnabled ?? true,
          })
        : sessionsToolParameters,
      executionMode: 'sequential',
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        try {
          return successfulToolResult(await executeSessionsTool(params, input, ctx, signal))
        } catch (error) {
          return failedToolResult(error)
        }
      },
    })
  }
}
