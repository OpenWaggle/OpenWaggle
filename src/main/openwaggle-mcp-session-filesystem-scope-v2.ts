import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { mcpLocalRefusal } from './openwaggle-mcp-refusal-message'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import { assertProjectAllowed } from './openwaggle-mcp-workspace-policy'
import {
  assertFilesystemWriteScope,
  FilesystemWriteScopeError,
} from './utils/filesystem-write-scope'

/**
 * Narrows a payload's project paths and export destination to the server's grants. A path
 * outside them is refused as `target_scope_denied`, worded like a Session Host refusal.
 */
export async function prepareMcpSessionFilesystemScope(
  options: Pick<OpenWaggleMcpServeOptions, 'workspaceRoots' | 'exportRoots' | 'sessionIds'>,
  input: LocalSessionCommandPayload,
) {
  let payload = input
  if (
    payload.contract === 'session-lifecycle-v2' &&
    (payload.request.command.operation === 'create' ||
      payload.request.command.operation === 'launch')
  ) {
    if (options.workspaceRoots.length === 0) {
      throw mcpLocalRefusal(
        'target_scope_denied',
        'Creating or launching a Session requires an explicit MCP workspace grant.',
      )
    }
    payload = {
      ...payload,
      request: {
        ...payload.request,
        command: {
          ...payload.request.command,
          projectPath: assertProjectAllowed(options, payload.request.command.projectPath),
        },
      },
    }
  }
  if (payload.contract === 'session-query-v2' && 'projectPath' in payload.request.query) {
    const projectPath = payload.request.query.projectPath
    if (projectPath) {
      if (options.workspaceRoots.length === 0) {
        throw mcpLocalRefusal(
          'target_scope_denied',
          'Project filters require an explicit MCP workspace grant.',
        )
      }
      payload = {
        ...payload,
        request: {
          ...payload.request,
          query: {
            ...payload.request.query,
            projectPath: assertProjectAllowed(options, projectPath),
          },
        },
      }
    }
  }
  if (
    payload.contract === 'session-control-v2' &&
    payload.request.command.operation === 'export-create'
  ) {
    const scope = await assertFilesystemWriteScope({
      roots: options.exportRoots ?? [],
      destinationPath: payload.request.command.destinationPath,
    }).catch((error: unknown) => {
      throw error instanceof FilesystemWriteScopeError
        ? mcpLocalRefusal('target_scope_denied', error.message)
        : error
    })
    payload = {
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
  return payload
}
