import { match } from '@diegogbrisa/ts-match'
import type { ExtensionContext, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { SessionWorkspaceResourceRepositoryShape } from '../../ports/session-workspace-resource-repository'
import {
  LIVE_SOURCE_CONTROL_TOOL_BACKEND,
  type SourceControlToolBackend,
} from './source-control-tool-backend'
import { configureSessionSourceControl } from './source-control-tool-configure'
import {
  assertSourceControlArguments,
  sourceControlToolParameters,
} from './source-control-tool-parameters'
import { redactSourceControlText } from './source-control-tool-redaction'
import { readSourceControlStatus } from './source-control-tool-status'

export type { SourceControlToolBackend } from './source-control-tool-backend'

export interface SourceControlToolInput {
  readonly sessionId: string
  readonly workspaces: Pick<SessionWorkspaceResourceRepositoryShape, 'getBound'>
  readonly backend?: SourceControlToolBackend
}

const DESCRIPTION =
  'Read and configure how OpenWaggle reaches the source control host (GitHub or GitLab, including self-hosted) behind this Session\'s git remote. "status" is read-only: remote, host provider and how it was decided, repository, CLI and signed-in accounts, the current branch\'s change request, the change request open destination, and any attention with a nextStep. Use it to diagnose "View PR/MR doesn\'t work". "configure" applies one persistent change the user asked for and asks them to authorize it: "set-host-provider" or "declare-project-host" for a host like "git.acme.io", "set-open-destination" ("inspector" or "website" at a scope), or "set-repository-account". It never signs in or reads tokens; when status says not-signed-in, tell the user how to sign in.'

async function execute(
  input: SourceControlToolInput,
  params: unknown,
  ctx: ExtensionContext,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  assertSourceControlArguments(params)
  const backend = input.backend ?? LIVE_SOURCE_CONTROL_TOOL_BACKEND
  const bound = await Effect.runPromise(input.workspaces.getBound(SessionId(input.sessionId)))
  if (!bound) throw new Error('The Session no longer has an active Workspace.')
  const projectRoot = (await backend.resolveProjectRoot(bound.workingPath)) ?? bound.projectPath
  const scope = { workingPath: bound.workingPath, projectRoot }
  return match(params)
    .with({ action: 'status' }, () => readSourceControlStatus(scope, backend))
    .with({ action: 'configure' }, (change) =>
      configureSessionSourceControl(change, scope, backend, ctx, signal),
    )
    .exhaustive()
}

export function createSourceControlToolExtension(input: SourceControlToolInput): ExtensionFactory {
  return (pi) => {
    pi.registerTool({
      name: 'source_control',
      label: 'Source Control',
      description: DESCRIPTION,
      parameters: sourceControlToolParameters,
      executionMode: 'sequential',
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        try {
          const result = await execute(input, params, ctx, signal)
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result }
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: redactSourceControlText(
                  error instanceof Error ? error.message : String(error),
                ),
              },
            ],
            details: null,
            isError: true,
          }
        }
      },
    })
  }
}
