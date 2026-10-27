import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { assertFilesystemWriteScope } from '../../utils/filesystem-write-scope'
import { getOpenWaggleAuthorize } from './agent-kernel/openwaggle-authorize-channel'
import type { buildSessionsToolPayload } from './sessions-tool-payload'

type SessionsToolPayload = ReturnType<typeof buildSessionsToolPayload>

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

export async function authorizeAttachments(
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

export async function authorizeExport(
  payload: SessionsToolPayload,
  input: { readonly workingDirectory: string },
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
