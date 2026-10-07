import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import type { ChangeRequestResult } from '@shared/types/change-request'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { SourceControlHostsOverview } from '@shared/types/source-control'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { vi } from 'vitest'
import type { SourceControlProvider } from '../../../ports/source-control-provider'
import type { SourceControlRemoteResolution } from '../../../services/source-control/source-control-remote-resolution'
import type { SourceControlSettingsAccess } from '../../../services/source-control/source-control-settings-access'
import type { WorkingTreeSourceControlResult } from '../../../services/source-control/working-tree-source-control'
import { OPENWAGGLE_AUTHORIZE_KEY } from '../agent-kernel/openwaggle-authorize-channel'
import {
  createSourceControlToolExtension,
  type SourceControlToolBackend,
} from '../source-control-tool-extension'

export const WORKING_PATH = '/worktrees/session-1'
export const PROJECT_ROOT = '/projects/app'

export const GITLAB_REPOSITORY = {
  provider: 'gitlab',
  host: 'git.acme.io',
  owner: 'Platform/Web',
  repository: 'App',
} as const

export function resolvedGitlab(
  overrides: Partial<Extract<SourceControlRemoteResolution, { kind: 'resolved' }>> = {},
): SourceControlRemoteResolution {
  return {
    kind: 'resolved',
    remote: { name: 'origin', url: 'git@git.acme.io:Platform/Web/App.git' },
    repository: GITLAB_REPOSITORY,
    hostState: { host: 'git.acme.io', provider: 'gitlab', source: 'cli-sign-in' },
    attention: null,
    ...overrides,
  }
}

type Backend = SourceControlToolBackend

const NO_HOSTS: SourceControlHostsOverview = {
  hosts: [],
  cliInstalled: { gh: false, glab: false },
}

export interface HarnessOptions {
  readonly resolution?: SourceControlRemoteResolution
  readonly changeRequest?: ChangeRequestResult
  readonly branch?: string | null
  readonly hosts?: SourceControlHostsOverview
  readonly settings?: Partial<typeof DEFAULT_SETTINGS>
  readonly approved?: boolean
  readonly hasUI?: boolean
  readonly providerAccount?: string | null
}

function workingTreeResult(
  resolution: SourceControlRemoteResolution,
  providerAccount: string | null,
): WorkingTreeSourceControlResult {
  if (resolution.kind !== 'resolved') return { resolution, sourceControl: null }
  return {
    resolution,
    sourceControl: {
      remote: resolution.remote,
      repository: resolution.repository,
      hostState: resolution.hostState,
      info: { id: resolution.repository.provider, host: resolution.repository.host },
      provider: fromPartial<SourceControlProvider>({ account: () => providerAccount }),
      webUrl: `https://${resolution.repository.host}/${resolution.repository.owner}/${resolution.repository.repository}`,
    },
  }
}

export function sourceControlToolHarness(options: HarnessOptions = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...options.settings }
  const access: SourceControlSettingsAccess = {
    read: async () => settings,
    patch: vi.fn(async () => undefined),
  }
  const resolution = options.resolution ?? resolvedGitlab()
  const backend = {
    access: () => access,
    openWorkingTree: vi.fn<Backend['openWorkingTree']>(async () =>
      workingTreeResult(resolution, options.providerAccount ?? null),
    ),
    resolveProjectRoot: vi.fn<Backend['resolveProjectRoot']>(async () => PROJECT_ROOT),
    currentBranch: vi.fn<Backend['currentBranch']>(async () =>
      options.branch === undefined ? 'feature' : options.branch,
    ),
    findCurrentChangeRequest: vi.fn<Backend['findCurrentChangeRequest']>(async () => ({
      result: options.changeRequest ?? {
        ok: false,
        code: 'no-change-request',
        message: 'No change request.',
      },
      provider: fromPartial<SourceControlProvider>({
        account: () => options.providerAccount ?? null,
      }),
      repository: GITLAB_REPOSITORY,
    })),
    attentionForFailure: vi.fn<Backend['attentionForFailure']>(
      (failure) => failure.attention ?? null,
    ),
    listHosts: vi.fn<Backend['listHosts']>(async () => options.hosts ?? NO_HOSTS),
    resolveOpenDestination: vi.fn<Backend['resolveOpenDestination']>(async () => ({
      destination: 'inspector',
      source: 'default',
    })),
    configure: vi.fn<Backend['configure']>(async () => ({ ok: true })),
  } satisfies Backend
  const authorize = vi.fn(async () => options.approved ?? true)
  const ctx = fromPartial<ExtensionContext>({
    hasUI: options.hasUI ?? true,
    ui: Object.assign({ confirm: async () => false }, { [OPENWAGGLE_AUTHORIZE_KEY]: authorize }),
  })
  let tool: ToolDefinition | undefined
  createSourceControlToolExtension({
    sessionId: SessionId('session-1'),
    workspaces: {
      getBound: () =>
        Effect.succeed({
          id: 'workspace-1',
          projectPath: PROJECT_ROOT,
          workingPath: WORKING_PATH,
          kind: 'managed-worktree',
          pending: false,
          worktreeBranch: 'feature',
        }),
    },
    backend,
  })(
    fromPartial<ExtensionAPI>({
      registerTool: (registered: ToolDefinition) => {
        tool = registered
      },
    }),
  )
  if (!tool) throw new Error('Tool was not registered')
  const registered = tool
  const run = (params: unknown) => registered.execute('call', params, undefined, undefined, ctx)
  const parameters: unknown = registered.parameters
  return { parameters, run, backend, access, authorize }
}
