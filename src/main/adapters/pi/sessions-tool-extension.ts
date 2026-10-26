import type { ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { HIVE_TOOL_NAME } from '@shared/constants/hive'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import type { SessionCapability } from '@shared/types/session-capability'
import type { TSchema } from 'typebox'
import { discoverAgentDefinitions } from '../../agents/agent-definition-discovery'
import { createLogger } from '../../logger'
import { sessionCommandFailureMessage } from '../../session-host/session-command-failure-message'
import { executeSessionToolCommand } from '../../session-host/session-tool-gateway'
import { describeError } from '../../utils/describe-error'
import { assertFilesystemWriteScope } from '../../utils/filesystem-write-scope'
import { getOpenWaggleAuthorize } from './agent-kernel/openwaggle-authorize-channel'
import {
  assertSessionsToolActionPermitted,
  sessionsToolSchemaForGrant,
} from './sessions-tool-capability-schema'
import { assertSessionsToolActionArguments } from './sessions-tool-flat-schema'
import { sessionsToolPromptGuidelines } from './sessions-tool-guidelines'
import type { SessionsToolParameters } from './sessions-tool-parameters'
import { buildSessionsToolPayload } from './sessions-tool-payload'
import {
  executeSessionsToolSchedule,
  isSessionsToolScheduleAction,
} from './sessions-tool-schedule-payload'
import { scheduledTasksToolResult } from './sessions-tool-schedule-result'
import { resolveSessionsToolSessionLinks } from './sessions-tool-session-links'

const logger = createLogger('hive-tool')

interface SessionsToolExtensionInput {
  readonly sessionId: string
  readonly runId: string
  readonly workingDirectory: string
  readonly projectPath?: string
  readonly agentDefinitionToggles?: Readonly<Record<string, boolean>>
  readonly sessionCapabilities?: readonly SessionCapability[]
  readonly modelMultiAgentEnabled?: boolean
}

type SessionsToolPayload = ReturnType<typeof buildSessionsToolPayload>

export { buildSessionsToolPayload } from './sessions-tool-payload'

export function queryAgentDefinitionsForTool(
  input: Extract<
    SessionsToolParameters,
    { action: 'agent_definitions_list' | 'agent_definitions_search' }
  >,
  projectPath: string,
  enabledByName: Readonly<Record<string, boolean>> = {},
) {
  return discoverAgentDefinitions({
    projectPath,
    ...(input.action === 'agent_definitions_search' ? { query: input.query } : {}),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    enabledByName,
  })
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
          requester: 'OpenWaggle Hive',
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
          requester: 'OpenWaggle Hive',
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
          requester: 'OpenWaggle Hive',
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

function sendSessionsToolCommand(
  input: SessionsToolExtensionInput,
  payload: LocalSessionCommandPayload,
  signal?: AbortSignal,
): Promise<LocalSessionCommandResult> {
  return executeSessionToolCommand({
    sourceSessionId: input.sessionId,
    sourceRunId: input.runId,
    workingDirectory: input.workingDirectory,
    projectPath: input.projectPath,
    payload,
    ...(signal ? { signal } : {}),
  })
}

async function executeSessionsToolCall(
  rawParams: unknown,
  input: SessionsToolExtensionInput,
  ctx: ExtensionContext,
  toolCallId: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new Error('aborted')
  assertSessionsToolActionArguments(rawParams)
  const params = resolveSessionsToolSessionLinks(rawParams)
  if (isAgentDefinitionAction(params)) {
    return successfulToolResult(
      await queryAgentDefinitionsForTool(
        params,
        input.projectPath ?? input.workingDirectory,
        input.agentDefinitionToggles,
      ),
    )
  }
  if (isSessionsToolScheduleAction(params)) {
    const result = await executeSessionsToolSchedule(params, { ...input, toolCallId }, (payload) =>
      sendSessionsToolCommand(input, payload, signal),
    )
    return result.contract === 'scheduled-tasks-v1'
      ? scheduledTasksToolResult(result)
      : successfulToolResult(result)
  }
  const initialPayload = buildSessionsToolPayload(params, input)
  await authorizeAttachments(initialPayload, ctx, signal)
  const payload = await authorizeExport(initialPayload, input, ctx, signal)
  return successfulToolResult(await sendSessionsToolCommand(input, payload, signal))
}

function successfulToolResult(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result }
}

function failedToolResult(error: unknown) {
  const message = sessionCommandFailureMessage(error)
  // The result text leaves out Host context such as paths in a cause; the log keeps all of it.
  logger.warn('Hive tool command failed', { message, error: describeError(error) })
  return {
    content: [{ type: 'text' as const, text: message }],
    details: undefined,
    isError: true,
  }
}

export function createSessionsToolExtension(input: SessionsToolExtensionInput): ExtensionFactory {
  const grant = {
    capabilities: input.sessionCapabilities,
    modelMultiAgentEnabled: input.modelMultiAgentEnabled ?? true,
  }
  return (pi) => {
    // Typed as a plain schema: arguments stay unknown until assertSessionsToolActionArguments.
    pi.registerTool<TSchema, unknown>({
      name: HIVE_TOOL_NAME,
      label: 'Hive',
      description:
        'Coordinate your Hive of durable OpenWaggle Sessions. Spawn Worker Sessions in the current Hive, discover and read authorized Sessions, report durable peer context, send future Follow-ups, steer an exact active Run, interrupt it, or manage Scheduled tasks. The Hive root is the Queen Session; every descendant is a Worker Session. Workers are ordinary Sessions with independent transcripts, listed in the Hive panel, and may continue after this Run ends.',
      promptSnippet:
        'Use hive to spawn and coordinate durable Worker Sessions when parallel or delegated work is useful.',
      promptGuidelines: sessionsToolPromptGuidelines(
        input.sessionCapabilities,
        grant.modelMultiAgentEnabled,
      ),
      parameters: sessionsToolSchemaForGrant(grant),
      // Runs before schema validation, so an action outside the grant is refused by name.
      prepareArguments: (args) => {
        assertSessionsToolActionPermitted(args, grant)
        return args
      },
      executionMode: 'sequential',
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        try {
          return await executeSessionsToolCall(params, input, ctx, toolCallId, signal)
        } catch (error) {
          return failedToolResult(error)
        }
      },
    })
  }
}
