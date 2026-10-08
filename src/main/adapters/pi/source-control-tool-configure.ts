import { createHash } from 'node:crypto'
import { match } from '@diegogbrisa/ts-match'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { safeDecodeUnknown } from '@shared/schema'
import { sourceControlConfigureRequestSchema } from '@shared/schemas/source-control'
import {
  type SourceControlConfigureRequest,
  type SourceControlConfigureResult,
  sourceControlRepositoryKey,
} from '@shared/types/source-control'
import { getOpenWaggleAuthorize } from './agent-kernel/openwaggle-authorize-channel'
import type { SourceControlToolBackend } from './source-control-tool-backend'
import type { SourceControlChangeParameters } from './source-control-tool-parameters'
import { redactSourceControlText } from './source-control-tool-redaction'
import type { SourceControlToolScope } from './source-control-tool-status'

const PROVIDER_NAMES = { github: 'GitHub', gitlab: 'GitLab' } as const
const DESTINATION_NAMES = { inspector: 'the in-app inspector', website: 'the provider website' }
const SCOPE_NAMES = {
  user: 'for you in every project',
  'project-local': 'for this project on this machine',
  'project-shared': "for everyone on this project (the project's shared settings file)",
}

function failure(message: string): SourceControlConfigureResult {
  return { ok: false, message }
}

/** The Session's resolved repository key, which per-repository settings are stored under. */
async function sessionRepositoryKey(
  scope: SourceControlToolScope,
  backend: SourceControlToolBackend,
) {
  const { resolution } = await backend.openWorkingTree(scope.workingPath, backend.access(), {
    probeRemote: true,
    projectPath: scope.projectRoot,
  })
  return resolution.kind === 'resolved' ? sourceControlRepositoryKey(resolution.repository) : null
}

/** Fill the Session-derived fields of one change; a string explains why it cannot apply. */
async function sessionRequest(
  params: SourceControlChangeParameters,
  scope: SourceControlToolScope,
  backend: SourceControlToolBackend,
): Promise<SourceControlConfigureRequest | string> {
  return match(params)
    .with({ change: 'set-host-provider' }, ({ host, provider }) => ({
      kind: 'set-host-provider' as const,
      host,
      provider,
    }))
    .with({ change: 'declare-project-host' }, ({ host, provider }) => ({
      kind: 'declare-project-host' as const,
      projectPath: scope.projectRoot,
      workingPath: scope.workingPath,
      host,
      provider,
    }))
    .with({ change: 'set-open-destination' }, ({ scope: level, destination }) => ({
      kind: 'set-open-destination' as const,
      scope: level,
      destination,
      ...(level === 'user' ? {} : { projectPath: scope.projectRoot }),
      ...(level === 'project-shared' ? { workingPath: scope.workingPath } : {}),
    }))
    .with({ change: 'set-repository-account' }, async ({ login }) => {
      const repository = await sessionRepositoryKey(scope, backend)
      if (!repository) {
        return "This Session's remote has no resolved repository. Run status first."
      }
      return { kind: 'set-repository-account' as const, repository, login }
    })
    .exhaustive()
}

function describeChange(request: SourceControlConfigureRequest) {
  return match(request)
    .with({ kind: 'set-host-provider' }, ({ host, provider }) =>
      match(provider)
        .with(null, () => `Forget the provider chosen or detected for ${host}.`)
        .with(
          'unsupported',
          () => `Treat ${host} as neither GitHub nor GitLab and stop asking about it.`,
        )
        .with('github', 'gitlab', (id) => `Use ${PROVIDER_NAMES[id]} for ${host} in every project.`)
        .exhaustive(),
    )
    .with({ kind: 'declare-project-host' }, ({ host, provider }) =>
      provider
        ? `Declare in this project's shared .openwaggle/settings.json that ${host} runs ${PROVIDER_NAMES[provider]}, and approve it for this project.`
        : `Remove ${host} from this project's shared .openwaggle/settings.json.`,
    )
    .with({ kind: 'set-open-destination' }, ({ scope, destination }) =>
      destination
        ? `Open change requests in ${DESTINATION_NAMES[destination]} ${SCOPE_NAMES[scope]}.`
        : `Clear the change request open destination ${SCOPE_NAMES[scope]}.`,
    )
    .with({ kind: 'set-repository-account' }, ({ repository, login }) =>
      login
        ? `Use the account "${login}" for ${repository}.`
        : `Choose the account for ${repository} automatically.`,
    )
    .with({ kind: 'decide-project-declaration' }, ({ decision }) =>
      decision === 'approved'
        ? "Approve this project's declared source control hosts."
        : "Decline this project's declared source control hosts.",
    )
    .exhaustive()
}

async function authorize(
  ctx: ExtensionContext,
  request: SourceControlConfigureRequest,
  signal?: AbortSignal,
) {
  if (!ctx.hasUI) {
    throw new Error('Changing source control requires an OpenWaggle authorization context.')
  }
  const title = 'Allow source control change?'
  const message = describeChange(request)
  const channel = getOpenWaggleAuthorize(ctx.ui)
  const approved = channel
    ? await channel({
        title,
        message,
        scopeKey: {
          requesterId: 'openwaggle:source-control',
          requester: 'Source Control',
          capability: 'actions.execute',
          resource: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
        },
        ...(signal ? { signal } : {}),
      })
    : await ctx.ui.confirm(title, message, { signal })
  if (!approved) throw new Error('The source control change was not authorized.')
}

/** Apply one authorized change scoped to the Session's project and working tree. */
export async function configureSessionSourceControl(
  params: SourceControlChangeParameters,
  scope: SourceControlToolScope,
  backend: SourceControlToolBackend,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<SourceControlConfigureResult> {
  const filled = await sessionRequest(params, scope, backend)
  if (typeof filled === 'string') return failure(filled)
  const decoded = safeDecodeUnknown(sourceControlConfigureRequestSchema, filled)
  if (!decoded.success)
    return failure(`Invalid source control change: ${decoded.issues.join('; ')}`)
  await authorize(ctx, decoded.data, signal)
  signal?.throwIfAborted()
  const result = await backend.configure(decoded.data, backend.access())
  return result.ok ? result : failure(redactSourceControlText(result.message))
}
